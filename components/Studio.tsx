"use client";

import { Player, type PlayerRef } from "@remotion/player";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { resolveSceneTimings } from "../lib/align";
import type { Scene } from "../lib/schema";
import { VideoProject } from "../lib/schema";
import { Video } from "../remotion/Video";
import { getJson, postJson } from "./api";

type ScriptJobState = {
  status: "running" | "done" | "error";
  step?: string;
  project?: unknown;
  error?: string;
};

/**
 * The running job id outlives the page, so a reload reconnects to it instead
 * of starting a second, equally expensive generation.
 */
const JOB_KEY = "infographics-studio.scriptJob";
/** Which project this browser had open, so a reload comes back to it. */
const PROJECT_KEY = "infographics-studio.projectId";
const rememberJob = (id: string) => {
  try {
    window.localStorage.setItem(JOB_KEY, id);
  } catch {
    // Private mode or a full quota — polling still works for this session.
  }
};
const recallJob = (): string | null => {
  try {
    return window.localStorage.getItem(JOB_KEY);
  } catch {
    return null;
  }
};
const forgetJob = () => {
  try {
    window.localStorage.removeItem(JOB_KEY);
  } catch {
    // Nothing to clean up if storage is unavailable.
  }
};

const rememberProject = (id: string | null) => {
  try {
    if (id) window.localStorage.setItem(PROJECT_KEY, id);
    else window.localStorage.removeItem(PROJECT_KEY);
  } catch {
    // Losing the pointer costs one click in the project list, nothing more.
  }
};
const recallProject = (): string | null => {
  try {
    return window.localStorage.getItem(PROJECT_KEY);
  } catch {
    return null;
  }
};

type ProjectSummary = {
  id: string;
  title: string;
  topic: string;
  updatedAt: number;
  words: number;
  scenes: number;
  hasScript: boolean;
  hasAudio: boolean;
  renderUrl?: string;
};

type ProjectRecord = {
  id: string;
  title: string;
  project: unknown;
  lastRender?: { renderId: string; outputUrl?: string; sizeBytes?: number };
};

/** "vor 4 Minuten" — enough to tell a fresh save from a stale one. */
function ago(timestamp: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) return "gerade eben";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `vor ${minutes} Min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `vor ${hours} Std`;
  return `vor ${Math.round(hours / 24)} Tagen`;
}

/** What a project row says it already contains, so nothing is redone blindly. */
function stageOf(p: ProjectSummary): string {
  if (p.renderUrl) return "gerendert";
  if (p.hasAudio) return "Ton fertig";
  if (p.hasScript) return "Skript fertig";
  return "leer";
}
import { SceneInspector } from "./SceneInspector";
import { Timeline } from "./Timeline";
import { Button, Field, formatTimecode, Note, Panel } from "./ui";

type RenderState = {
  renderId: string;
  status: "queued" | "rendering" | "done" | "error";
  progress: number;
  phase: string;
  outputUrl?: string;
  error?: string;
};

export const Studio: React.FC<{ seed: VideoProject }> = ({ seed }) => {
  const [project, setProject] = useState<VideoProject>(seed);
  const [topic, setTopic] = useState("");
  const [selectedSceneId, setSelectedSceneId] = useState<string | null>(
    seed.scenes[0]?.id ?? null,
  );
  const [currentFrame, setCurrentFrame] = useState(0);

  const [scriptBusy, setScriptBusy] = useState(false);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [scriptError, setScriptError] = useState<string | null>(null);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [scriptDone, setScriptDone] = useState(false);
  const [scriptJobId, setScriptJobId] = useState<string | null>(null);
  const [scriptStep, setScriptStep] = useState<string | null>(null);

  const [voices, setVoices] = useState<{ voiceId: string; name: string }[]>([]);
  const [voiceId, setVoiceId] = useState<string>("");

  const [render, setRender] = useState<RenderState | null>(null);
  const playerRef = useRef<PlayerRef>(null);

  // ---- Projects -----------------------------------------------------------
  const [projectId, setProjectId] = useState<string | null>(null);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [saveState, setSaveState] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [projectError, setProjectError] = useState<string | null>(null);

  const timing = useMemo(() => resolveSceneTimings(project), [project]);
  const wordCount = useMemo(
    () => project.voiceover.trim().split(/\s+/).filter(Boolean).length,
    [project.voiceover],
  );
  const hasAudio = Boolean(project.audioUrl && project.alignment);

  // ---- Player <-> timeline sync ------------------------------------------
  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    const onFrame = (e: { detail: { frame: number } }) =>
      setCurrentFrame(e.detail.frame);
    player.addEventListener("frameupdate", onFrame);
    return () => player.removeEventListener("frameupdate", onFrame);
  }, []);

  const seek = useCallback((frame: number) => {
    playerRef.current?.seekTo(frame);
    setCurrentFrame(frame);
  }, []);

  // ---- Projects -----------------------------------------------------------
  //
  // A script costs a research pass and several model calls; a voiceover costs
  // characters at ElevenLabs. Both used to live in React state alone, so a
  // reload threw them away and the only way back was to generate something
  // different. Saving happens on its own, because a save the user has to
  // remember is one they will forget exactly once.

  const refreshProjects = useCallback(async () => {
    const result = await getJson<{ projects: ProjectSummary[] }>(
      "/api/projects",
    );
    if (result.ok) setProjects(result.data.projects);
  }, []);

  useEffect(() => {
    void refreshProjects();
  }, [refreshProjects]);

  /**
   * What was last written, so the autosave can tell a real change from a
   * re-render. Without it, loading a project immediately saves it back.
   */
  const lastSaved = useRef<string | null>(null);

  const save = useCallback(
    async (extra?: { lastRender?: ProjectRecord["lastRender"] }) => {
      const payload = JSON.stringify(project);
      setSaveState("saving");

      const result = await postJson<{ id: string }>("/api/projects", {
        id: projectId ?? undefined,
        title: project.title || project.topic,
        project,
        ...extra,
      });

      if (!result.ok) {
        setSaveState("error");
        setProjectError(result.error);
        return;
      }

      lastSaved.current = payload;
      setProjectId(result.data.id);
      rememberProject(result.data.id);
      setSaveState("saved");
      setSavedAt(Date.now());
      setProjectError(null);
      void refreshProjects();
    },
    [project, projectId, refreshProjects],
  );

  // Autosave, debounced. Nothing is written for the seed placeholder: an empty
  // project saved on every page load would fill the list with rubbish.
  useEffect(() => {
    const worthKeeping = project.voiceover.trim().length > 0;
    if (!worthKeeping && !projectId) return;
    if (lastSaved.current === JSON.stringify(project)) return;

    const id = window.setTimeout(() => void save(), 1200);
    return () => window.clearTimeout(id);
  }, [project, projectId, save]);

  const loadProject = useCallback(
    async (id: string) => {
      setProjectError(null);
      const result = await getJson<ProjectRecord>(
        `/api/projects/${encodeURIComponent(id)}`,
      );
      if (!result.ok) {
        setProjectError(result.error);
        // A pointer to a project that no longer exists should not survive to
        // fail again on the next reload.
        if (recallProject() === id) rememberProject(null);
        return;
      }

      const parsed = VideoProject.safeParse(result.data.project);
      if (!parsed.success) {
        setProjectError("Dieses Projekt lässt sich nicht mehr laden.");
        return;
      }

      lastSaved.current = JSON.stringify(parsed.data);
      setProject(parsed.data);
      setProjectId(result.data.id);
      rememberProject(result.data.id);
      setTopic(parsed.data.topic);
      setSelectedSceneId(parsed.data.scenes[0]?.id ?? null);
      setScriptDone(parsed.data.voiceover.trim().length > 0);
      setScriptError(null);
      setVoiceError(null);
      setSaveState("saved");
      setSavedAt(result.data.lastRender ? Date.now() : null);

      // A finished render is part of the project: showing it again beats
      // re-rendering a video that already exists.
      setRender(
        result.data.lastRender?.outputUrl
          ? {
              renderId: result.data.lastRender.renderId,
              status: "done",
              progress: 1,
              phase: "Gerendert",
              outputUrl: result.data.lastRender.outputUrl,
            }
          : null,
      );
      seek(0);
    },
    [seek],
  );

  // Come back to whatever was open before the reload.
  useEffect(() => {
    const stored = recallProject();
    if (stored) void loadProject(stored);
    // Deliberately once, on mount: later changes to projectId are ours.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const newProject = useCallback(() => {
    lastSaved.current = null;
    setProjectId(null);
    rememberProject(null);
    setProject(seed);
    setTopic("");
    setScriptDone(false);
    setScriptError(null);
    setVoiceError(null);
    setRender(null);
    setSaveState("idle");
    setSavedAt(null);
    setSelectedSceneId(seed.scenes[0]?.id ?? null);
    seek(0);
  }, [seed, seek]);

  const deleteProject = useCallback(async () => {
    if (!projectId) return;
    // The shared helper only speaks POST and this is the one DELETE in the
    // studio — a bare fetch is clearer than a verb tunnelled through a query
    // string. The audio and any rendered video survive; only the project goes.
    await fetch(`/api/projects/${encodeURIComponent(projectId)}`, {
      method: "DELETE",
    }).catch(() => undefined);
    newProject();
    void refreshProjects();
  }, [projectId, newProject, refreshProjects]);

  // ---- Voice list ---------------------------------------------------------
  useEffect(() => {
    void getJson<{
      voices?: { voiceId: string; name: string }[];
      defaultVoiceId?: string;
    }>("/api/voice").then((result) => {
      if (!result.ok) return;
      setVoices(result.data.voices ?? []);
      setVoiceId(
        result.data.defaultVoiceId ?? result.data.voices?.[0]?.voiceId ?? "",
      );
    });
  }, []);

  // ---- 01 Thema -----------------------------------------------------------
  //
  // Generation runs as a background job on the server. The browser only starts
  // it and then asks how it is going, so closing the tab — or the laptop —
  // does not abandon a script that takes minutes to write.
  async function generateScript() {
    setScriptBusy(true);
    setScriptError(null);
    setScriptDone(false);

    const result = await postJson<{ jobId: string }>("/api/script", { topic });
    if (!result.ok) {
      setScriptError(result.error);
      setScriptBusy(false);
      return;
    }

    rememberJob(result.data.jobId);
    setScriptJobId(result.data.jobId);
  }

  /** Adopt a finished job, whether we started it this session or not. */
  const applyScriptJob = useCallback(
    (job: ScriptJobState) => {
      if (job.status === "running") return false;

      if (job.status === "done" && job.project) {
        const parsed = VideoProject.safeParse(job.project);
        if (parsed.success) {
          setProject(parsed.data);
          setSelectedSceneId(parsed.data.scenes[0]?.id ?? null);
          setRender(null);
          setScriptDone(true);
          seek(0);
        } else {
          setScriptError(
            "Das erzeugte Skript passt nicht zum Schema. Versuch es erneut.",
          );
        }
      } else {
        setScriptError(job.error ?? "Die Skripterzeugung ist fehlgeschlagen.");
      }

      forgetJob();
      setScriptJobId(null);
      setScriptStep(null);
      setScriptBusy(false);
      return true;
    },
    [seek],
  );

  // Poll a running job, including one started before this page was loaded.
  useEffect(() => {
    if (!scriptJobId) return;
    setScriptBusy(true);

    let cancelled = false;
    const tick = async () => {
      const result = await getJson<ScriptJobState>(
        `/api/script?jobId=${encodeURIComponent(scriptJobId)}`,
      );
      if (cancelled) return;

      if (!result.ok) {
        // A 404 means the job is gone; anything else is likely transient, so
        // keep polling rather than throwing away a run that may still finish.
        if (result.error.includes("keinen Auftrag")) {
          setScriptError(
            "Der Auftrag ist nicht mehr auffindbar. Starte die Erzeugung neu.",
          );
          forgetJob();
          setScriptJobId(null);
          setScriptBusy(false);
        }
        return;
      }
      setScriptStep(result.data.step ?? null);
      applyScriptJob(result.data);
    };

    void tick();
    const id = window.setInterval(() => void tick(), 3000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [scriptJobId, applyScriptJob]);

  // Resume after a reload: the job kept running on the server meanwhile.
  useEffect(() => {
    const stored = recallJob();
    if (stored) setScriptJobId(stored);
  }, []);

  // ---- 03 Stimme ----------------------------------------------------------
  async function generateVoice() {
    setVoiceBusy(true);
    setVoiceError(null);
    try {
      const result = await postJson<{
        audioUrl: string;
        alignment: NonNullable<VideoProject["alignment"]>;
      }>("/api/voice", {
        projectId: project.id,
        voiceover: project.voiceover,
        voiceId: voiceId || undefined,
      });
      if (!result.ok) {
        setVoiceError(result.error);
        return;
      }
      setProject((p) => ({
        ...p,
        audioUrl: result.data.audioUrl,
        alignment: result.data.alignment,
      }));
      setRender(null);
      seek(0);
    } finally {
      setVoiceBusy(false);
    }
  }

  // ---- 04 Rendern ---------------------------------------------------------
  async function startRender() {
    setRender({
      renderId: "",
      status: "queued",
      progress: 0,
      phase: "Wird gestartet",
    });
    const result = await postJson<{ renderId: string }>("/api/render", {
      project,
    });
    if (!result.ok) {
      setRender({
        renderId: "",
        status: "error",
        progress: 0,
        phase: "Abgebrochen",
        error: result.error,
      });
      return;
    }
    setRender({
      renderId: result.data.renderId,
      status: "rendering",
      progress: 0,
      phase: "Sandbox wird gestartet",
    });
  }

  // Poll progress while a render is in flight.
  useEffect(() => {
    if (!render?.renderId) return;
    if (render.status === "done" || render.status === "error") return;

    const id = window.setInterval(async () => {
      try {
        const response = await fetch(
          `/api/progress?renderId=${encodeURIComponent(render.renderId)}`,
        );
        if (!response.ok) return;
        const data = (await response.json()) as RenderState;
        setRender((current) =>
          current && current.renderId === data.renderId
            ? { ...current, ...data }
            : current,
        );
      } catch {
        // A dropped poll is not fatal — the next tick tries again.
      }
    }, 2000);

    return () => window.clearInterval(id);
  }, [render?.renderId, render?.status]);

  // A finished render belongs to the project. Without this the video exists in
  // Blob storage and nothing remembers where — reopening the project would
  // offer to render it again, which is the most expensive button in the app.
  const savedRenderId = useRef<string | null>(null);
  useEffect(() => {
    if (render?.status !== "done" || !render.outputUrl) return;
    if (savedRenderId.current === render.renderId) return;
    savedRenderId.current = render.renderId;
    void save({
      lastRender: { renderId: render.renderId, outputUrl: render.outputUrl },
    });
  }, [render?.status, render?.renderId, render?.outputUrl, save]);

  // ---- Scene editing ------------------------------------------------------
  const updateScene = useCallback((id: string, patch: Partial<Scene>) => {
    setProject((p) => ({
      ...p,
      scenes: p.scenes.map((s) =>
        s.id === id ? ({ ...s, ...patch } as Scene) : s,
      ),
    }));
  }, []);

  const moveScene = useCallback((fromIndex: number, toIndex: number) => {
    setProject((p) => {
      const next = [...p.scenes];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return { ...p, scenes: next };
    });
  }, []);

  const selectedScene =
    timing.scenes.find((s) => s.id === selectedSceneId) ?? null;

  const renderDisabledReason = !hasAudio
    ? "Der Render braucht die Tonspur: die Szenenzeiten kommen aus den ElevenLabs-Timestamps."
    : render?.status === "rendering" || render?.status === "queued"
      ? "Es läuft bereits ein Render."
      : null;

  return (
    <div className="studio">
      <header
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 14,
          padding: "14px 20px",
          borderBottom: "1px solid var(--grid)",
        }}
      >
        <span className="display" style={{ fontSize: 15 }}>
          Infographics Studio
        </span>
        <span className="mono" style={{ fontSize: 11, color: "#5b6672" }}>
          {project.width}×{project.height} · {project.fps} fps ·{" "}
          {formatTimecode(timing.totalFrames / project.fps)}
        </span>
      </header>

      <div className="studio-grid">
        {/* ---------------- Left rail ---------------- */}
        <div className="studio-rail">
          <Panel
            step="00"
            title="Projekt"
            right={
              <span className="mono" style={{ fontSize: 11, color: "#5b6672" }}>
                {saveState === "saving"
                  ? "speichert…"
                  : saveState === "error"
                    ? "nicht gespeichert"
                    : savedAt
                      ? `gespeichert ${ago(savedAt)}`
                      : projectId
                        ? "gespeichert"
                        : "ungespeichert"}
              </span>
            }
          >
            <select
              value={projectId ?? ""}
              onChange={(e) => {
                const id = e.target.value;
                if (id) void loadProject(id);
                else newProject();
              }}
              aria-label="Gespeichertes Projekt"
              style={{
                width: "100%",
                padding: "10px 12px",
                border: "1px solid var(--grid)",
                background: "#fff",
                fontSize: 13,
              }}
            >
              <option value="">— Neues Projekt —</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title} · {stageOf(p)} · {ago(p.updatedAt)}
                </option>
              ))}
            </select>

            <div style={{ height: 8 }} />
            <div style={{ display: "flex", gap: 8 }}>
              <Button variant="ghost" onClick={newProject}>
                Neu
              </Button>
              <Button
                variant="ghost"
                onClick={() => void deleteProject()}
                disabled={!projectId}
                title={
                  projectId
                    ? "Löscht nur das Projekt — Ton und fertiges Video bleiben."
                    : "Dieses Projekt ist noch nicht gespeichert."
                }
              >
                Löschen
              </Button>
            </div>

            {projectError ? <Note tone="alert">{projectError}</Note> : null}
            {projects.length === 0 && !projectId ? (
              <Note tone="info">
                Sobald ein Skript da ist, wird es hier automatisch gespeichert.
                Skript und Ton überleben dann jeden Reload.
              </Note>
            ) : null}
          </Panel>

          <Panel step="01" title="Thema">
            <Field
              value={topic}
              placeholder="z. B. Europa geht das Essen aus"
              onChange={(e) => setTopic(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && topic.trim().length >= 3 && !scriptBusy) {
                  void generateScript();
                }
              }}
              aria-label="Stichwort"
            />
            <div style={{ height: 8 }} />
            <Button
              onClick={() => void generateScript()}
              disabled={scriptBusy || topic.trim().length < 3}
            >
              {scriptBusy
                ? (scriptStep ?? "Skript wird erzeugt…")
                : scriptDone
                  ? "Skript erzeugt"
                  : "Skript erzeugen"}
            </Button>
            {scriptError ? <Note tone="alert">{scriptError}</Note> : null}
            {scriptBusy ? (
              <Note tone="info">
                Läuft auf dem Server weiter. Du kannst den Tab schließen und
                später zurückkommen.
              </Note>
            ) : null}
            {!topic && !scriptDone ? (
              <Note tone="info">
                Gib ein Thema ein. Aus einem Satz wird ein Fünf-Minuten-Video.
              </Note>
            ) : null}
          </Panel>

          <Panel
            step="02"
            title="Skript"
            right={
              <span className="mono" style={{ fontSize: 11, color: "#5b6672" }}>
                {wordCount} Wörter
              </span>
            }
          >
            <textarea
              value={project.voiceover}
              onChange={(e) => {
                const voiceover = e.target.value;
                // Editing the script invalidates the take it was spoken from.
                setProject((p) => ({
                  ...p,
                  voiceover,
                  audioUrl: undefined,
                  alignment: undefined,
                }));
              }}
              aria-label="Voiceover"
              style={{
                width: "100%",
                height: 220,
                padding: 12,
                border: "1px solid var(--grid)",
                background: "#fff",
                fontSize: 13,
                lineHeight: 1.5,
                resize: "vertical",
              }}
            />
            {hasAudio ? null : (
              <Note tone="info">
                Ohne Tonspur ist die Zeitleiste geschätzt. Die echten Zeiten
                kommen aus den Timestamps.
              </Note>
            )}
          </Panel>

          <Panel step="03" title="Stimme">
            <select
              value={voiceId}
              onChange={(e) => setVoiceId(e.target.value)}
              aria-label="Stimme"
              style={{
                width: "100%",
                padding: "10px 12px",
                border: "1px solid var(--grid)",
                background: "#fff",
                fontSize: 14,
              }}
            >
              {voices.length === 0 ? (
                <option value="">Standardstimme aus der Konfiguration</option>
              ) : (
                voices.map((v) => (
                  <option key={v.voiceId} value={v.voiceId}>
                    {v.name}
                  </option>
                ))
              )}
            </select>
            <div style={{ height: 8 }} />
            <Button
              onClick={() => void generateVoice()}
              disabled={voiceBusy || project.voiceover.trim().length < 50}
            >
              {voiceBusy
                ? "Stimme wird erzeugt…"
                : hasAudio
                  ? "Stimme neu erzeugen"
                  : "Generieren"}
            </Button>
            {voiceError ? <Note tone="alert">{voiceError}</Note> : null}
            {hasAudio && !voiceError ? (
              <Note tone="live">
                Tonspur liegt vor — alle Szenenzeiten stammen jetzt aus den
                Timestamps.
              </Note>
            ) : null}
          </Panel>

          <Panel step="04" title="Rendern">
            <div title={renderDisabledReason ?? undefined}>
              <Button
                onClick={() => void startRender()}
                disabled={Boolean(renderDisabledReason)}
              >
                {render?.status === "rendering" || render?.status === "queued"
                  ? "Rendert…"
                  : "Rendern"}
              </Button>
            </div>

            {renderDisabledReason ? (
              <Note tone="info">{renderDisabledReason}</Note>
            ) : null}

            {render && render.status !== "error" ? (
              <>
                <div
                  style={{
                    marginTop: 12,
                    height: 6,
                    background: "var(--grid)",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      width: `${Math.round(render.progress * 100)}%`,
                      height: "100%",
                      background: "var(--live)",
                      transition: "width 300ms linear",
                    }}
                  />
                </div>
                <Note tone={render.status === "done" ? "live" : "info"}>
                  <span className="mono">
                    {Math.round(render.progress * 100)}%
                  </span>{" "}
                  {render.status === "done" ? "Gerendert" : render.phase}
                </Note>
              </>
            ) : null}

            {render?.error ? <Note tone="alert">{render.error}</Note> : null}

            {render?.outputUrl ? (
              <a
                href={render.outputUrl}
                download
                style={{
                  display: "block",
                  marginTop: 10,
                  padding: "11px 14px",
                  border: "1px solid var(--live)",
                  color: "var(--live)",
                  textAlign: "center",
                  textDecoration: "none",
                  fontSize: 13,
                  fontWeight: 600,
                }}
              >
                MP4 herunterladen
              </a>
            ) : null}
          </Panel>
        </div>

        {/* ---------------- Stage ---------------- */}
        <div className="studio-stage">
          <div
            style={{
              width: "100%",
              maxWidth: 1000,
              border: "1px solid var(--ink)",
              background: "var(--ink)",
              padding: 8,
            }}
          >
            <Player
              ref={playerRef}
              component={Video as React.FC<Record<string, unknown>>}
              inputProps={{ project } as unknown as Record<string, unknown>}
              durationInFrames={Math.max(1, timing.totalFrames)}
              fps={project.fps}
              compositionWidth={project.width}
              compositionHeight={project.height}
              style={{ width: "100%" }}
              controls
              acknowledgeRemotionLicense
            />
          </div>
        </div>

        {/* ---------------- Scene list ---------------- */}
        <div className="studio-scenes">
          <Panel
            step="Szenen"
            title=""
            right={
              timing.warnings.length > 0 ? (
                <span
                  className="mono"
                  style={{ fontSize: 11, color: "var(--alert)" }}
                >
                  {timing.warnings.length} ⚠
                </span>
              ) : null
            }
          >
            <SceneInspector
              timing={timing}
              selectedSceneId={selectedSceneId}
              onSelect={(id) => {
                setSelectedSceneId(id);
                const scene = timing.scenes.find((s) => s.id === id);
                if (scene) seek(scene.from);
              }}
              onMove={moveScene}
              onUpdate={updateScene}
              selectedScene={selectedScene}
              fps={project.fps}
            />
          </Panel>
        </div>
      </div>

      <Timeline
        audioUrl={project.audioUrl}
        timing={timing}
        fps={project.fps}
        currentFrame={currentFrame}
        selectedSceneId={selectedSceneId}
        onSeek={seek}
        onSelectScene={setSelectedSceneId}
      />
    </div>
  );
};
