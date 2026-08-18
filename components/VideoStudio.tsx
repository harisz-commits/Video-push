"use client";

import { Player, type PlayerRef } from "@remotion/player";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IMAGE_MODELS, resolveModel } from "../lib/image-models";
import {
  resolveStoryTiming,
  StoryProject,
  type StoryProject as Story,
} from "../lib/story";
import { WORDS_PER_MINUTE } from "../lib/story-prompt";
import { StoryVideo } from "../remotion/story/StoryVideo";
import { getJson, postJson } from "./api";
import { Button, formatTimecode, Note, Panel } from "./ui";

/**
 * The video format's studio.
 *
 * Ordered by what each step costs, cheapest first, and that order is the whole
 * interface. Writing is fractions of a cent, so it happens first and can be
 * thrown away. Drawing is dollars, so it sits behind its own button with its
 * price on it. Speaking spends a monthly allowance rather than a per-call
 * price, so it comes after the pictures are worth speaking over. Rendering is
 * last because it is the only step that cannot be undone by pressing it again.
 */

const JOB_KEY = "infographics-studio.storyJob";
const PROJECT_KEY = "infographics-studio.storyProjectId";
const TOLERATED_POLL_FAILURES = 3;

type StoryJobState = {
  status: "running" | "done" | "error";
  step?: string;
  project?: unknown;
  error?: string;
  cost?: { label: string; inputTokens: number; outputTokens: number; cents: number };
  startedAt?: number;
};

type ImageJobState = {
  status: "running" | "done" | "error";
  step?: string;
  project?: unknown;
  error?: string;
  warning?: string;
  drawn?: number;
  reused?: number;
  cents?: number;
};

const formatCents = (cents: number) =>
  cents >= 100
    ? `${(cents / 100).toFixed(2).replace(".", ",")} $`
    : `${cents.toFixed(cents < 1 ? 2 : 1).replace(".", ",")} US-Cent`;

export const VideoStudio: React.FC<{ seed: Story }> = ({ seed }) => {
  const [project, setProject] = useState<Story>(seed);
  const [topic, setTopic] = useState("");
  const [minutes, setMinutes] = useState(5);
  const [imageBudget, setImageBudget] = useState(60);
  const [imageModelId, setImageModelId] = useState("gemini-3.1-flash-lite-image");
  const imageModel = resolveModel(imageModelId);

  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cost, setCost] = useState<StoryJobState["cost"] | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);

  const [drawJobId, setDrawJobId] = useState<string | null>(null);
  const [drawBusy, setDrawBusy] = useState(false);
  const [drawStep, setDrawStep] = useState<string | null>(null);
  const [drawNote, setDrawNote] = useState<string | null>(null);
  const [drawError, setDrawError] = useState<string | null>(null);

  const [voiceJobId, setVoiceJobId] = useState<string | null>(null);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [voiceNote, setVoiceNote] = useState<string | null>(null);

  const [projectId, setProjectId] = useState<string | null>(null);
  const [render, setRender] = useState<{
    renderId: string;
    status: string;
    progress: number;
    phase?: string;
    outputUrl?: string;
    error?: string;
  } | null>(null);

  const playerRef = useRef<PlayerRef>(null);
  const lastSaved = useRef<string | null>(null);

  const timing = useMemo(() => resolveStoryTiming(project), [project]);
  const undrawn = useMemo(
    () => project.images.filter((i) => !i.url),
    [project.images],
  );
  const drawnCount = project.images.length - undrawn.length;

  // ---- Autosave -----------------------------------------------------------
  const save = useCallback(async () => {
    const payload = JSON.stringify(project);
    const result = await postJson<{ id: string }>("/api/projects", {
      id: projectId ?? undefined,
      title: project.title,
      project,
    });
    if (!result.ok) return;
    lastSaved.current = payload;
    setProjectId(result.data.id);
    try {
      window.localStorage.setItem(PROJECT_KEY, result.data.id);
    } catch {
      // Not being able to remember the id costs a save, not the work.
    }
  }, [project, projectId]);

  useEffect(() => {
    const payload = JSON.stringify(project);
    if (lastSaved.current === payload) return;
    if (!projectId && payload === JSON.stringify(seed)) return;
    const id = window.setTimeout(() => void save(), 1200);
    return () => window.clearTimeout(id);
  }, [project, projectId, save, seed]);

  // ---- Writing ------------------------------------------------------------
  async function generate() {
    setBusy(true);
    setError(null);
    setCost(null);
    const result = await postJson<{ jobId: string }>("/api/story", {
      topic,
      minutes,
      imageBudget,
    });
    if (!result.ok) {
      setError(result.error);
      setBusy(false);
      return;
    }
    try {
      window.localStorage.setItem(JOB_KEY, result.data.jobId);
    } catch {
      // The job still runs; only picking it up after a reload is lost.
    }
    setJobId(result.data.jobId);
    setStartedAt(Date.now());
  }

  useEffect(() => {
    if (!busy || !startedAt) return;
    const id = window.setInterval(
      () => setElapsed(Math.round((Date.now() - startedAt) / 1000)),
      1000,
    );
    return () => window.clearInterval(id);
  }, [busy, startedAt]);

  useEffect(() => {
    if (!jobId) return;
    setBusy(true);
    let cancelled = false;
    let failures = 0;

    const tick = async () => {
      const result = await getJson<StoryJobState>(
        `/api/story?jobId=${encodeURIComponent(jobId)}`,
      );
      if (cancelled) return;
      if (!result.ok) {
        failures += 1;
        if (failures > TOLERATED_POLL_FAILURES) {
          setError(result.error);
          setBusy(false);
        }
        return;
      }
      failures = 0;
      setStep(result.data.step ?? null);
      if (result.data.cost) setCost(result.data.cost);
      if (!startedAt && typeof result.data.startedAt === "number") {
        setStartedAt(result.data.startedAt);
      }
      if (result.data.status === "running") return;

      if (result.data.status === "done" && result.data.project) {
        const parsed = StoryProject.safeParse(result.data.project);
        if (parsed.success) {
          lastSaved.current = null;
          setProjectId(null);
          setProject(parsed.data);
          setRender(null);
          playerRef.current?.seekTo(0);
        } else {
          setError("Das erzeugte Video passt nicht zum Schema.");
        }
      } else {
        setError(result.data.error ?? "Die Erzeugung ist fehlgeschlagen.");
      }
      try {
        window.localStorage.removeItem(JOB_KEY);
      } catch {
        // Nothing depends on this succeeding.
      }
      setJobId(null);
      setStep(null);
      setStartedAt(null);
      setBusy(false);
    };

    void tick();
    const id = window.setInterval(() => void tick(), 3000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [jobId, startedAt]);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(JOB_KEY);
      if (stored) setJobId(stored);
    } catch {
      // Starting fresh is a fine answer.
    }
  }, []);

  // ---- Drawing ------------------------------------------------------------
  async function draw() {
    setDrawBusy(true);
    setDrawError(null);
    setDrawNote(null);
    const result = await postJson<{ jobId: string }>("/api/story/images", {
      project,
      model: imageModelId,
    });
    if (!result.ok) {
      setDrawError(result.error);
      setDrawBusy(false);
      return;
    }
    setDrawJobId(result.data.jobId);
  }

  useEffect(() => {
    if (!drawJobId) return;
    let cancelled = false;
    let failures = 0;

    const tick = async () => {
      const result = await getJson<ImageJobState>(
        `/api/story/images?jobId=${encodeURIComponent(drawJobId)}`,
      );
      if (cancelled) return;
      if (!result.ok) {
        failures += 1;
        if (failures > TOLERATED_POLL_FAILURES) {
          setDrawError(result.error);
          setDrawBusy(false);
          setDrawJobId(null);
        }
        return;
      }
      failures = 0;
      setDrawStep(result.data.step ?? null);
      if (result.data.status === "running") return;

      if (result.data.status === "done" && result.data.project) {
        const parsed = StoryProject.safeParse(result.data.project);
        if (parsed.success) setProject(parsed.data);
        const paid = result.data.drawn ?? 0;
        const free = result.data.reused ?? 0;
        setDrawNote(
          `${paid} gezeichnet für ${formatCents(result.data.cents ?? 0)}` +
            (free > 0 ? `, ${free} aus der Bibliothek übernommen — kostenlos.` : "."),
        );
        if (result.data.warning) setDrawError(result.data.warning);
      } else {
        setDrawError(result.data.error ?? "Die Bilder konnten nicht gezeichnet werden.");
      }
      setDrawJobId(null);
      setDrawStep(null);
      setDrawBusy(false);
    };

    void tick();
    const id = window.setInterval(() => void tick(), 2500);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [drawJobId]);

  // ---- Voice --------------------------------------------------------------
  async function speak() {
    setVoiceBusy(true);
    setVoiceError(null);
    setVoiceNote(null);
    const result = await postJson<{ jobId: string }>("/api/story/voice", {
      project,
    });
    if (!result.ok) {
      setVoiceError(result.error);
      setVoiceBusy(false);
      return;
    }
    setVoiceJobId(result.data.jobId);
  }

  useEffect(() => {
    if (!voiceJobId) return;
    let cancelled = false;
    const tick = async () => {
      const result = await getJson<{
        status: string;
        audioUrl?: string;
        cues?: number[];
        audioSeconds?: number;
        characters?: number;
        voice?: string;
        error?: string;
      }>(`/api/story/voice?jobId=${encodeURIComponent(voiceJobId)}`);
      if (cancelled || !result.ok) return;
      if (result.data.status === "running") return;

      if (result.data.status === "done" && result.data.audioUrl) {
        const data = result.data;
        setProject((p) => ({
          ...p,
          audioUrl: data.audioUrl,
          cues: data.cues,
          audioSeconds: data.audioSeconds,
          // The old character alignment belongs to whoever spoke last. Keeping
          // it beside fresh cues would leave two disagreeing sources of truth,
          // and the timing code prefers cues — so the stale one would sit
          // there being wrong and invisible.
          alignment: undefined,
          voice: { provider: "elevenlabs", name: data.voice },
        }));
        setVoiceNote(
          `${(data.characters ?? 0).toLocaleString("de-DE")} Zeichen gesprochen · ${(data.audioSeconds ?? 0).toFixed(0)} s`,
        );
      } else {
        setVoiceError(result.data.error ?? "Die Sprachausgabe ist fehlgeschlagen.");
      }
      setVoiceJobId(null);
      setVoiceBusy(false);
    };
    void tick();
    const id = window.setInterval(() => void tick(), 2500);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [voiceJobId]);

  // ---- Render -------------------------------------------------------------
  async function startRender() {
    const result = await postJson<{ renderId: string }>("/api/render", {
      project,
      projectId: projectId ?? undefined,
    });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setRender({ renderId: result.data.renderId, status: "queued", progress: 0 });
  }

  useEffect(() => {
    if (!render || render.status === "done" || render.status === "error") return;
    let cancelled = false;
    const tick = async () => {
      const result = await getJson<typeof render>(
        `/api/progress?renderId=${encodeURIComponent(render.renderId)}`,
      );
      if (cancelled || !result.ok || !result.data) return;
      setRender(result.data);
    };
    const id = window.setInterval(() => void tick(), 4000);
    void tick();
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [render]);

  const estimatedWords = Math.round(minutes * WORDS_PER_MINUTE);
  const estimatedChars = Math.round(estimatedWords * 7);
  const drawCost = undrawn.length * imageModel.cents;

  return (
    // The same three-column shell the other two studios use, rather than a
    // grid of its own. That was the bug: an inline "minmax(340px, 420px) 1fr"
    // has no breakpoint, so on a phone the rail kept its 340px, the stage was
    // crushed to a strip, and the whole page overflowed sideways. The shared
    // classes collapse to one column below 1280px and put the player first.
    <div className="studio-grid">
      <div className="studio-rail">
        <Panel step="01" title="Thema">
          <textarea
            value={topic}
            placeholder="z. B. Die Ägypter und wie sie die Hitze überlebt haben — gern mit Details: welche Bauweisen, welche Epoche, was betont werden soll."
            onChange={(e) => setTopic(e.target.value)}
            aria-label="Video-Thema"
            rows={5}
            style={{
              width: "100%",
              padding: "10px 12px",
              border: "1px solid var(--grid)",
              background: "#fff",
              fontSize: 14,
              lineHeight: 1.45,
              resize: "vertical",
              overflowY: "auto",
            }}
          />

          <label className="mono" style={{ fontSize: 11, color: "#5b6672", display: "block", margin: "12px 0 6px" }}>
            {minutes} Minuten · etwa {estimatedWords.toLocaleString("de-DE")} Wörter
          </label>
          <input
            type="range"
            min={1}
            max={25}
            value={minutes}
            onChange={(e) => setMinutes(Number(e.target.value))}
            style={{ width: "100%" }}
            aria-label="Länge in Minuten"
          />

          <label className="mono" style={{ fontSize: 11, color: "#5b6672", display: "block", margin: "12px 0 6px" }}>
            höchstens {imageBudget} verschiedene Bilder · {formatCents(imageBudget * imageModel.cents)}
          </label>
          <input
            type="range"
            min={4}
            max={200}
            step={2}
            value={imageBudget}
            onChange={(e) => setImageBudget(Number(e.target.value))}
            style={{ width: "100%" }}
            aria-label="Bildbudget"
          />

          <select
            value={imageModelId}
            onChange={(e) => setImageModelId(e.target.value)}
            aria-label="Bildmodell"
            style={{
              width: "100%",
              padding: "9px 10px",
              border: "1px solid var(--grid)",
              background: "#fff",
              fontSize: 13,
              marginTop: 12,
            }}
          >
            {IMAGE_MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label} — {formatCents(m.cents)} je Bild
              </option>
            ))}
          </select>

          <div style={{ height: 10 }} />
          <Button onClick={() => void generate()} disabled={busy || topic.trim().length < 3}>
            {busy ? (step ?? "Wird geschrieben…") : "Skript schreiben"}
          </Button>
          {error ? <Note tone="alert">{error}</Note> : null}
          {cost ? (
            <Note tone="info">
              <span className="mono">
                {formatCents(cost.cents)} — {cost.label}
              </span>{" "}
              — gemessen. Bilder und Stimme kosten getrennt.
            </Note>
          ) : null}
          {busy ? (
            <Note tone="info">
              <span className="mono">
                {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")}
              </span>{" "}
              — läuft auf dem Server. Es wird noch nichts gezeichnet.
            </Note>
          ) : null}
          <Note tone="info">
            Erst schreiben, dann zeichnen. Ein Skript kostet Bruchteile eines
            Cents und lässt sich wegwerfen; {imageBudget} Bilder kosten{" "}
            {formatCents(imageBudget * imageModel.cents)}.
          </Note>
        </Panel>

        {project.shots.length > 0 && project.id !== seed.id ? (
          <>
            <Panel
              step="02"
              title="Bilder"
              right={
                <span className="mono" style={{ fontSize: 11, color: "#5b6672" }}>
                  {drawnCount}/{project.images.length}
                </span>
              }
            >
              <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
                {project.style.palette.map((c) => (
                  <span
                    key={c}
                    title={c}
                    style={{
                      width: 26,
                      height: 26,
                      background: c,
                      border: "1px solid var(--grid)",
                    }}
                  />
                ))}
                <span style={{ fontSize: 12, alignSelf: "center", marginLeft: 6 }}>
                  {project.style.name}
                </span>
              </div>

              <Button
                onClick={() => void draw()}
                disabled={drawBusy || undrawn.length === 0}
              >
                {drawBusy
                  ? (drawStep ?? "wird gezeichnet…")
                  : undrawn.length === 0
                    ? "Alle Bilder gezeichnet"
                    : `${undrawn.length} Bilder zeichnen — ${formatCents(drawCost)}`}
              </Button>
              {drawError ? <Note tone="alert">{drawError}</Note> : null}
              {drawNote ? <Note tone="info">{drawNote}</Note> : null}

              <div style={{ marginTop: 12, maxHeight: 260, overflowY: "auto" }}>
                {project.images.map((img) => (
                  <div
                    key={img.key}
                    style={{
                      display: "flex",
                      gap: 8,
                      alignItems: "center",
                      padding: "5px 0",
                      borderBottom: "1px solid var(--grid)",
                      fontSize: 12,
                    }}
                  >
                    {img.url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={img.url}
                        alt=""
                        style={{ width: 48, height: 27, objectFit: "cover" }}
                      />
                    ) : (
                      <span
                        style={{
                          width: 48,
                          height: 27,
                          background: "var(--grid)",
                          display: "inline-block",
                        }}
                      />
                    )}
                    <span style={{ flex: 1 }}>{img.name}</span>
                    {img.reused ? (
                      <span className="mono" style={{ fontSize: 10, color: "#5b6672" }}>
                        Bibliothek
                      </span>
                    ) : null}
                  </div>
                ))}
              </div>
            </Panel>

            <Panel
              step="03"
              title="Stimme"
              right={
                <span className="mono" style={{ fontSize: 11, color: "#5b6672" }}>
                  {project.audioUrl ? `${timing.audioSeconds.toFixed(0)} s` : "fehlt"}
                </span>
              }
            >
              <Button onClick={() => void speak()} disabled={voiceBusy}>
                {voiceBusy
                  ? "wird gesprochen…"
                  : project.audioUrl
                    ? "Neu sprechen"
                    : "Sprechen"}
              </Button>
              {voiceError ? <Note tone="alert">{voiceError}</Note> : null}
              {voiceNote ? <Note tone="info">{voiceNote}</Note> : null}
              <label
                className="mono"
                style={{ fontSize: 11, color: "#5b6672", display: "block", margin: "10px 0 4px" }}
              >
                Tempo {project.speed.toFixed(2).replace(".", ",")}
              </label>
              <input
                type="range"
                min={0.9}
                max={1.2}
                step={0.05}
                value={project.speed}
                onChange={(e) =>
                  setProject((p) => ({ ...p, speed: Number(e.target.value) }))
                }
                style={{ width: "100%" }}
                aria-label="Sprechtempo"
              />
              <Note tone="info">
                Gemessen: 1,15 ergab 146 Wörter pro Minute, 1,20 etwa 152. Mehr
                gibt ElevenLabs nicht her. Kostet ungefähr{" "}
                {estimatedChars.toLocaleString("de-DE")} Zeichen vom Kontingent.
              </Note>
            </Panel>

            <Panel step="04" title="Rendern">
              <Button
                onClick={() => void startRender()}
                disabled={Boolean(render && render.status !== "done" && render.status !== "error")}
              >
                {render && render.status !== "done" && render.status !== "error"
                  ? `${Math.round((render.progress ?? 0) * 100)} % — ${render.phase ?? "läuft"}`
                  : "Video rendern"}
              </Button>
              {render?.error ? <Note tone="alert">{render.error}</Note> : null}
              {render?.outputUrl ? (
                <Note tone="live">
                  <a href={render.outputUrl} target="_blank" rel="noreferrer">
                    Fertiges Video herunterladen
                  </a>
                </Note>
              ) : null}
            </Panel>
          </>
        ) : null}
      </div>

      <div className="studio-stage">
        <div style={{ width: "100%" }}>
          <Player
            ref={playerRef}
            component={StoryVideo as React.FC<Record<string, unknown>>}
            inputProps={{ project } as unknown as Record<string, unknown>}
            durationInFrames={Math.max(1, timing.totalFrames)}
            fps={project.fps}
            compositionWidth={project.width}
            compositionHeight={project.height}
            style={{ width: "100%", aspectRatio: "16 / 9" }}
            controls
            acknowledgeRemotionLicense
          />
          <div
            className="mono"
            style={{ fontSize: 11, color: "#5b6672", padding: "10px 2px" }}
          >
            {formatTimecode(timing.totalFrames / project.fps)} ·{" "}
            {project.shots.length} Einstellungen · {project.images.length} Bilder
            ·{" "}
            {timing.estimated
              ? "Zeiten geschätzt, bis die Stimme da ist"
              : "Zeiten aus der Aufnahme"}
          </div>
        </div>
      </div>

      <div className="studio-scenes">
        <div
          className="mono"
          style={{ fontSize: 11, color: "#5b6672", padding: "18px 0 8px" }}
        >
          GESPROCHENER TEXT
        </div>
        {project.shots.length > 0 && project.id !== seed.id ? (
          project.shots.map((shot, i) => (
            <div
              key={shot.id}
              style={{
                display: "flex",
                gap: 8,
                padding: "6px 0",
                borderBottom: "1px solid var(--grid)",
                fontSize: 12.5,
                lineHeight: 1.45,
              }}
            >
              <span
                className="mono"
                style={{ fontSize: 10, color: "#5b6672", minWidth: 44 }}
              >
                {timing.shots[i]
                  ? formatTimecode(timing.shots[i].from / project.fps)
                  : ""}
              </span>
              <span style={{ flex: 1 }}>{shot.text}</span>
            </div>
          ))
        ) : (
          <p style={{ fontSize: 13, lineHeight: 1.5, color: "#5b6672" }}>
            Gib links ein Thema ein und lass das Skript schreiben.
          </p>
        )}
      </div>
    </div>
  );
};
