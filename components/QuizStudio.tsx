"use client";

import { Player, type PlayerRef } from "@remotion/player";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { QuizProject, resolveQuizTiming } from "../lib/quiz";
import { QuizVideo } from "../remotion/quiz/QuizVideo";
import { getJson, postJson } from "./api";
import { DownloadButton } from "./DownloadButton";
import { RenderList, type ProjectRenderRow } from "./RenderList";
import { Button, Field, formatTimecode, Note, Panel } from "./ui";

const JOB_KEY = "infographics-studio.quizJob";
const PROJECT_KEY = "infographics-studio.quizProjectId";

type QuizJobState = {
  status: "running" | "done" | "error";
  step?: string;
  project?: unknown;
  error?: string;
  startedAt?: number;
};

type RenderState = {
  renderId: string;
  status: "queued" | "rendering" | "done" | "error";
  progress: number;
  phase: string;
  outputUrl?: string;
  error?: string;
};

type Summary = {
  id: string;
  title: string;
  topic: string;
  format: "infographics" | "quiz";
  updatedAt: number;
  detail: string;
  renderUrl?: string;
  pendingRenders: number;
};

const remember = (key: string, id: string | null) => {
  try {
    if (id) window.localStorage.setItem(key, id);
    else window.localStorage.removeItem(key);
  } catch {
    // Storage being unavailable costs a click, not a project.
  }
};
const recall = (key: string): string | null => {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};

function ago(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return "gerade eben";
  const m = Math.round(s / 60);
  if (m < 60) return `vor ${m} Min`;
  const h = Math.round(m / 60);
  return h < 24 ? `vor ${h} Std` : `vor ${Math.round(h / 24)} Tagen`;
}

/**
 * The quiz side of the studio.
 *
 * A separate component rather than a mode inside the existing one. The two
 * formats share a project store and nothing else: different data, different
 * generation, different renderer, and — the part that matters — a different
 * answer to where a video's length comes from. Folding them together would
 * mean every panel asking which format it is in.
 */
export const QuizStudio: React.FC<{ seed: QuizProject }> = ({ seed }) => {
  const [project, setProject] = useState<QuizProject>(seed);
  const [topic, setTopic] = useState("");
  const [count, setCount] = useState(12);

  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<string | null>(null);
  /** When the current generation started, so the wait can be shown as a number. */
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [jobId, setJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [projectId, setProjectId] = useState<string | null>(null);
  const [projects, setProjects] = useState<Summary[]>([]);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");

  const [render, setRender] = useState<RenderState | null>(null);
  const [renders, setRenders] = useState<ProjectRenderRow[]>([]);
  const playerRef = useRef<PlayerRef>(null);
  const lastSaved = useRef<string | null>(null);
  const seedJson = useMemo(() => JSON.stringify(seed), [seed]);

  const timing = useMemo(() => resolveQuizTiming(project), [project]);

  // ---- Projects -----------------------------------------------------------
  const refreshProjects = useCallback(async () => {
    const result = await getJson<{ projects: Summary[] }>("/api/projects");
    if (result.ok) {
      setProjects(result.data.projects.filter((p) => p.format === "quiz"));
    }
  }, []);

  useEffect(() => {
    void refreshProjects();
  }, [refreshProjects]);

  const save = useCallback(
    async (extra?: { lastRender?: { renderId: string; outputUrl?: string; at: number } }) => {
      const payload = JSON.stringify(project);
      setSaveState("saving");
      const result = await postJson<{ id: string }>("/api/projects", {
        id: projectId ?? undefined,
        title: project.title,
        project,
        ...extra,
      });
      if (!result.ok) {
        setError(result.error);
        setSaveState("idle");
        return;
      }
      lastSaved.current = payload;
      setProjectId(result.data.id);
      remember(PROJECT_KEY, result.data.id);
      setSaveState("saved");
      void refreshProjects();
    },
    [project, projectId, refreshProjects],
  );

  useEffect(() => {
    const payload = JSON.stringify(project);
    if (lastSaved.current === payload) return;
    // The demo quiz is not the user's work and must not fill the list.
    if (!projectId && payload === seedJson) return;
    const id = window.setTimeout(() => void save(), 1200);
    return () => window.clearTimeout(id);
  }, [project, projectId, save, seedJson]);

  const loadProject = useCallback(async (id: string) => {
    const result = await getJson<{
      id: string;
      project: unknown;
      renders?: ProjectRenderRow[];
    }>(`/api/projects/${encodeURIComponent(id)}`);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    const parsed = QuizProject.safeParse(result.data.project);
    if (!parsed.success) {
      setError("Dieses Projekt ist kein Quiz.");
      return;
    }
    lastSaved.current = JSON.stringify(parsed.data);
    setProject(parsed.data);
    setProjectId(result.data.id);
    remember(PROJECT_KEY, result.data.id);
    setTopic(parsed.data.topic);
    setRenders(result.data.renders ?? []);
    setRender(null);
    setError(null);
  }, []);

  useEffect(() => {
    const stored = recall(PROJECT_KEY);
    if (stored) void loadProject(stored);
    // Once, on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Generation ---------------------------------------------------------
  async function generate() {
    setBusy(true);
    setError(null);
    const result = await postJson<{ jobId: string }>("/api/quiz", { topic, count });
    if (!result.ok) {
      setError(result.error);
      setBusy(false);
      return;
    }
    remember(JOB_KEY, result.data.jobId);
    setJobId(result.data.jobId);
    setStartedAt(Date.now());
  }

  // A generation that takes three minutes and one that died look identical
  // when the only thing on screen is the word "läuft". Counting makes the
  // difference visible without anyone having to guess.
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

    const tick = async () => {
      const result = await getJson<QuizJobState>(
        `/api/quiz?jobId=${encodeURIComponent(jobId)}`,
      );
      if (cancelled) return;
      if (!result.ok) {
        if (result.error.includes("kein Quiz")) {
          setError("Der Auftrag ist nicht mehr auffindbar. Starte ihn neu.");
          remember(JOB_KEY, null);
          setJobId(null);
          setBusy(false);
        }
        return;
      }
      setStep(result.data.step ?? null);
      // Resuming a job started in another session, or before a reload: without
      // this the counter would start from zero and lie about how long it has
      // been going.
      if (!startedAt && typeof result.data.startedAt === "number") {
        setStartedAt(result.data.startedAt);
      }
      if (result.data.status === "running") return;

      if (result.data.status === "done" && result.data.project) {
        const parsed = QuizProject.safeParse(result.data.project);
        if (parsed.success) {
          // A generated quiz is a new project, never an overwrite of the one
          // currently open.
          lastSaved.current = null;
          setProjectId(null);
          remember(PROJECT_KEY, null);
          setProject(parsed.data);
          setRender(null);
          playerRef.current?.seekTo(0);
        } else {
          setError("Das erzeugte Quiz passt nicht zum Schema.");
        }
      } else {
        setError(result.data.error ?? "Die Erzeugung ist fehlgeschlagen.");
      }
      remember(JOB_KEY, null);
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
  }, [jobId]);

  useEffect(() => {
    const stored = recall(JOB_KEY);
    if (stored) setJobId(stored);
  }, []);

  // ---- Render -------------------------------------------------------------
  async function startRender() {
    setRender({ renderId: "", status: "queued", progress: 0, phase: "Wird gestartet" });
    // The project id travels with the render, so the finished video finds its
    // way back here even if this tab is long gone by then.
    const result = await postJson<{ renderId: string }>("/api/render", {
      project,
      projectId: projectId ?? undefined,
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

  useEffect(() => {
    if (!render?.renderId) return;
    if (render.status === "done" || render.status === "error") return;
    const id = window.setInterval(async () => {
      const result = await getJson<RenderState>(
        `/api/progress?renderId=${encodeURIComponent(render.renderId)}`,
      );
      if (!result.ok) return;
      setRender((current) =>
        current && current.renderId === result.data.renderId
          ? { ...current, ...result.data }
          : current,
      );
    }, 2000);
    return () => window.clearInterval(id);
  }, [render?.renderId, render?.status]);

  // A finished render belongs to the project, so it survives a reload.
  useEffect(() => {
    if (render?.status !== "done" || !render.outputUrl || !projectId) return;
    void save({
      lastRender: {
        renderId: render.renderId,
        outputUrl: render.outputUrl,
        at: Date.now(),
      },
    });
    // Only when a render finishes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [render?.status, render?.outputUrl]);

  /**
   * The video this project can be downloaded as, if there is one.
   *
   * The render in flight wins; otherwise the newest one storage knows about,
   * which is what makes walking away from a render safe.
   */
  const finishedVideo = useMemo(() => {
    if (render?.status === "done" && render.outputUrl) {
      return { url: render.outputUrl, sizeBytes: undefined as number | undefined };
    }
    const newest = renders
      .filter((r) => r.outputUrl)
      .sort((a, b) => b.at - a.at)[0];
    return newest?.outputUrl
      ? { url: newest.outputUrl, sizeBytes: newest.sizeBytes }
      : null;
  }, [render?.status, render?.outputUrl, renders]);

  const levels = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const q of project.questions) counts[q.level] = (counts[q.level] ?? 0) + 1;
    return counts;
  }, [project.questions]);

  return (
    <div className="studio-grid">
      <div className="studio-rail">
        <Panel
          step="00"
          title="Projekt"
          right={
            <span className="mono" style={{ fontSize: 11, color: "#5b6672" }}>
              {saveState === "saving" ? "speichert…" : projectId ? "gespeichert" : "ungespeichert"}
            </span>
          }
        >
          <select
            value={projectId ?? ""}
            onChange={(e) => {
              const id = e.target.value;
              if (id) void loadProject(id);
              else {
                lastSaved.current = null;
                setProjectId(null);
                remember(PROJECT_KEY, null);
                setProject(seed);
                setRender(null);
              }
            }}
            aria-label="Gespeichertes Quiz"
            style={{
              width: "100%",
              padding: "10px 12px",
              border: "1px solid var(--grid)",
              background: "#fff",
              fontSize: 13,
            }}
          >
            <option value="">— Neues Quiz —</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title} · {p.detail} · {ago(p.updatedAt)}
              </option>
            ))}
          </select>
          {projects.length === 0 ? (
            <Note tone="info">
              Noch kein gespeichertes Quiz. Sobald eines erzeugt ist, landet es
              hier automatisch.
            </Note>
          ) : null}
        </Panel>

        <Panel step="01" title="Thema">
          <Field
            value={topic}
            placeholder="z. B. Flaggen der Welt"
            onChange={(e) => setTopic(e.target.value)}
            aria-label="Quiz-Thema"
          />
          <div style={{ height: 8 }} />
          <label
            className="mono"
            style={{ fontSize: 11, color: "#5b6672", display: "block", marginBottom: 6 }}
          >
            {count} Fragen · etwa {formatTimecode((count * 8 + 4))}
          </label>
          <input
            type="range"
            min={4}
            max={30}
            value={count}
            onChange={(e) => setCount(Number(e.target.value))}
            style={{ width: "100%" }}
            aria-label="Anzahl Fragen"
          />
          <div style={{ height: 10 }} />
          <Button onClick={() => void generate()} disabled={busy || topic.trim().length < 3}>
            {busy ? (step ?? "Fragen werden geschrieben…") : "Quiz erzeugen"}
          </Button>
          {error ? <Note tone="alert">{error}</Note> : null}
          {busy ? (
            <Note tone="info">
              <span className="mono">
                {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")}
              </span>{" "}
              — läuft auf dem Server. Tab wechseln oder schließen ist in
              Ordnung. {count} Fragen brauchen ein bis drei Minuten.
            </Note>
          ) : null}
        </Panel>

        <Panel
          step="02"
          title="Fragen"
          right={
            <span className="mono" style={{ fontSize: 11, color: "#5b6672" }}>
              {project.questions.length}
            </span>
          }
        >
          <div className="mono" style={{ fontSize: 11, color: "#5b6672", marginBottom: 10 }}>
            {(["easy", "medium", "hard", "impossible"] as const)
              .filter((l) => levels[l])
              .map((l) => `${l} ${levels[l]}`)
              .join(" · ")}
          </div>
          <div style={{ display: "grid", gap: 4, maxHeight: 280, overflowY: "auto" }}>
            {project.questions.map((q, i) => (
              <button
                key={q.id}
                onClick={() => {
                  const slot = timing.slots[i];
                  if (slot) playerRef.current?.seekTo(slot.from + 10);
                }}
                title="Zu dieser Frage springen"
                style={{
                  textAlign: "left",
                  padding: "7px 9px",
                  border: "1px solid var(--grid)",
                  background: "transparent",
                  cursor: "pointer",
                  fontSize: 12,
                  lineHeight: 1.35,
                }}
              >
                <span className="mono" style={{ color: "#5b6672" }}>
                  {String(i + 1).padStart(2, "0")} {q.level}
                </span>
                <br />
                <span style={{ fontWeight: 600 }}>
                  {q.flag ? `Flagge ${q.flag.toUpperCase()} → ` : ""}
                  {q.answers[q.correctIndex]}
                </span>
              </button>
            ))}
          </div>
        </Panel>

        <Panel step="03" title="Rendern">
          <Button
            onClick={() => void startRender()}
            disabled={
              project.questions.length === 0 ||
              render?.status === "rendering" ||
              render?.status === "queued"
            }
          >
            {render?.status === "rendering" || render?.status === "queued"
              ? `${Math.round((render.progress ?? 0) * 100)} % · ${render.phase}`
              : "Video rendern"}
          </Button>
          {render?.error ? <Note tone="alert">{render.error}</Note> : null}
          {finishedVideo ? (
            <DownloadButton
              url={finishedVideo.url}
              sizeBytes={finishedVideo.sizeBytes}
            />
          ) : null}
          <Note tone="info">
            Das Quiz braucht keine Tonspur, um zu rendern — seine Zeiten kommen
            aus der Uhr, nicht aus der Stimme.
          </Note>
          <RenderList renders={renders} activeRenderId={render?.renderId} />
        </Panel>
      </div>

      <div className="studio-stage">
        <Player
          ref={playerRef}
          component={QuizVideo as React.FC<Record<string, unknown>>}
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
          {project.questions.length} Fragen ·{" "}
          {formatTimecode(timing.totalFrames / project.fps)} · längster
          Standbild-Abschnitt{" "}
          {Math.max(
            ...project.questions.map((q) => q.thinkSeconds),
            0,
          ).toFixed(0)}
          s (mit laufendem Timer)
        </div>
      </div>
    </div>
  );
};
