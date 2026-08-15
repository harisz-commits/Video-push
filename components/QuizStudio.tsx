"use client";

import { Player, type PlayerRef } from "@remotion/player";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { QuizProject, resolveQuizTiming } from "../lib/quiz";
import { QuizVideo } from "../remotion/quiz/QuizVideo";
import { getJson, postJson } from "./api";
import { DownloadButton } from "./DownloadButton";
import { RenderList, type ProjectRenderRow } from "./RenderList";
import { ThumbnailPanel } from "./ThumbnailPanel";
import { Button, Field, formatTimecode, Note, Panel } from "./ui";

const JOB_KEY = "infographics-studio.quizJob";
const VOICE_KEY = "infographics-studio.quizVoiceJob";

/**
 * What the host says over the end card, unless someone changes it.
 *
 * A question, not a statement: "how many did you get" is the one thing a
 * viewer can only answer by typing, which is the whole reason the line exists.
 */
const DEFAULT_OUTRO_SPEECH =
  "Und wie viele hattest du diesmal richtig? Schreibe es uns in die Kommentare und abonniere unseren Kanal.";
const PROJECT_KEY = "infographics-studio.quizProjectId";
const MODE_KEY = "infographics-studio.quizMode";

/** Everyday, neutral, and identical in every language — see lib/quiz-language.ts. */
const DEFAULT_SAMPLE =
  "Heute ist ein schöner Tag. Ich denke, ich werde spazieren gehen und etwas Zeit an der frischen Luft verbringen.";

type Language = { id: string; name: string };

/**
 * Seven languages to start from, spread across families.
 *
 * A quiz of seven European languages is a quiz about accents; one that reaches
 * across scripts and families is a quiz about languages. These are the
 * defaults, not the rule — every one of them is a checkbox.
 */
function suggest(all: Language[]): string[] {
  const wanted = ["de", "fr", "es", "it", "pl", "tr", "ja", "pt", "nl", "sv"];
  const available = new Set(all.map((l) => l.id));
  const picked = wanted.filter((id) => available.has(id)).slice(0, 7);
  // If none of them exist, take whatever the model does offer rather than
  // showing an empty selection nobody can act on.
  return picked.length >= 3 ? picked : all.slice(0, 7).map((l) => l.id);
}

type QuizJobState = {
  status: "running" | "done" | "error";
  step?: string;
  project?: unknown;
  error?: string;
  /** Finished, but something optional did not — narration, usually. */
  warning?: string;
  startedAt?: number;
};

type VoiceJobState = {
  status: "running" | "done" | "error";
  audioUrl?: string;
  alignment?: { endTimesSeconds: number[] };
  error?: string;
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
  const [narrate, setNarrate] = useState(false);
  const [narrateAnswers, setNarrateAnswers] = useState(false);

  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<string | null>(null);
  /** Set when a quiz finished but something optional did not. */
  const [warning, setWarning] = useState<string | null>(null);
  /** When the current generation started, so the wait can be shown as a number. */
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [jobId, setJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /**
   * A rough upper bound on what narration will cost, before any question
   * exists to measure.
   *
   * Deliberately the pessimistic figure. Identical prompts are recorded once,
   * which in a flag quiz collapses fifty questions into a single clip — but
   * that saving depends on questions nobody has written yet, and a number that
   * turns out too low is worse than one that turns out too high.
   */
  const narrationEstimate = count * (narrateAnswers ? 96 : 60);

  const [projectId, setProjectId] = useState<string | null>(null);
  const [projects, setProjects] = useState<Summary[]>([]);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");

  const [render, setRender] = useState<RenderState | null>(null);
  const [renders, setRenders] = useState<ProjectRenderRow[]>([]);

  // Which kind of quiz the panels are set up for. A view state, not project
  // state: an existing project already knows what it is.
  const [mode, setMode] = useState<"general" | "language">("general");
  const [languages, setLanguages] = useState<Language[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [sentence, setSentence] = useState(DEFAULT_SAMPLE);

  const [voiceBusy, setVoiceBusy] = useState(false);
  const [voiceJobId, setVoiceJobId] = useState<string | null>(null);
  const [voiceError, setVoiceError] = useState<string | null>(null);
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

  // Which languages exist is the speaking model's business, so it is asked
  // rather than assumed.
  useEffect(() => {
    void getJson<{ languages: Language[] }>("/api/languages").then((result) => {
      if (!result.ok) return;
      setLanguages(result.data.languages);
      setPicked((current) =>
        current.length > 0 ? current : suggest(result.data.languages),
      );
    });
  }, []);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(MODE_KEY);
      if (stored === "language" || stored === "general") setMode(stored);
    } catch {
      // Defaulting to the general quiz is a fine answer.
    }
  }, []);

  const changeMode = (next: "general" | "language") => {
    setMode(next);
    try {
      window.localStorage.setItem(MODE_KEY, next);
    } catch {
      // The switch still works for this session.
    }
  };

  async function generateLanguages() {
    setBusy(true);
    setError(null);
    const chosen = languages.filter((l) => picked.includes(l.id));
    const result = await postJson<{ jobId: string }>("/api/quiz/language", {
      languages: chosen,
      sentence,
    });
    if (!result.ok) {
      setError(result.error);
      setBusy(false);
      return;
    }
    remember(JOB_KEY, result.data.jobId);
    setJobId(result.data.jobId);
    setStartedAt(Date.now());
  }

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
    setMode(parsed.data.mode);
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
    setWarning(null);
    const result = await postJson<{ jobId: string }>("/api/quiz", {
      topic,
      count,
      narrate,
      narrateAnswers,
    });
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
      setWarning(result.data.warning ?? null);
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

  // ---- Outro voice --------------------------------------------------------
  //
  // The same background-job shape as everything else expensive here: start it,
  // poll it, and let the tab go wherever it likes in between.
  const outroSpeech = project.outroSpeech ?? DEFAULT_OUTRO_SPEECH;

  async function generateOutroVoice() {
    setVoiceBusy(true);
    setVoiceError(null);
    const result = await postJson<{ jobId: string }>("/api/voice", {
      // Its own id, so an outro take never overwrites a full voiceover — both
      // are stored under the project they belong to.
      projectId: `${project.id}-outro`,
      voiceover: outroSpeech,
    });
    if (!result.ok) {
      setVoiceError(result.error);
      setVoiceBusy(false);
      return;
    }
    remember(VOICE_KEY, result.data.jobId);
    setVoiceJobId(result.data.jobId);
  }

  useEffect(() => {
    if (!voiceJobId) return;
    setVoiceBusy(true);
    let cancelled = false;

    const tick = async () => {
      const result = await getJson<VoiceJobState>(
        `/api/voice?jobId=${encodeURIComponent(voiceJobId)}`,
      );
      if (cancelled) return;
      if (!result.ok) {
        if (result.error.includes("keine Sprachausgabe")) {
          setVoiceError("Die Aufnahme ist nicht mehr auffindbar. Starte sie neu.");
          remember(VOICE_KEY, null);
          setVoiceJobId(null);
          setVoiceBusy(false);
        }
        return;
      }
      if (result.data.status === "running") return;

      if (result.data.status === "done" && result.data.audioUrl) {
        // The recording's own length decides how long the end card runs, so it
        // is stored beside the URL — nothing at render time can measure an mp3.
        const ends = result.data.alignment?.endTimesSeconds;
        const seconds = ends?.length ? ends[ends.length - 1] : undefined;
        setProject((p) => ({
          ...p,
          outroSpeech,
          outroAudioUrl: result.data.audioUrl,
          outroAudioSeconds: seconds,
        }));
      } else {
        setVoiceError(result.data.error ?? "Die Sprachausgabe ist fehlgeschlagen.");
      }
      remember(VOICE_KEY, null);
      setVoiceJobId(null);
      setVoiceBusy(false);
    };

    void tick();
    const id = window.setInterval(() => void tick(), 2000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [voiceJobId, outroSpeech]);

  useEffect(() => {
    const stored = recall(VOICE_KEY);
    if (stored) setVoiceJobId(stored);
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

        <Panel step="01" title={mode === "language" ? "Sprachen" : "Thema"}>
          {/*
            Two kinds of quiz behind one switch. The general one asks about a
            topic; the language one asks about a sound, and needs a completely
            different thing chosen — so the panel below it changes rather than
            growing a second half that is always half irrelevant.
          */}
          <div
            role="tablist"
            aria-label="Quiz-Art"
            style={{
              display: "flex",
              gap: 4,
              padding: 3,
              border: "1px solid var(--grid)",
              marginBottom: 12,
            }}
          >
            {(
              [
                ["general", "Allgemein"],
                ["language", "Sprache"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                role="tab"
                aria-selected={mode === key}
                onClick={() => changeMode(key)}
                style={{
                  flex: 1,
                  border: "none",
                  padding: "8px 10px",
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: "pointer",
                  background: mode === key ? "var(--ink)" : "transparent",
                  color: mode === key ? "var(--field)" : "var(--ink)",
                }}
              >
                {label}
              </button>
            ))}
          </div>

          {mode === "language" ? (
            <>
              <div
                className="mono"
                style={{ fontSize: 11, color: "#5b6672", marginBottom: 6 }}
              >
                {picked.length} von {languages.length} Sprachen gewählt
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 2,
                  maxHeight: 240,
                  overflowY: "auto",
                  border: "1px solid var(--grid)",
                  padding: 8,
                }}
              >
                {languages.map((l) => (
                  <label
                    key={l.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 7,
                      fontSize: 12,
                      cursor: "pointer",
                      padding: "3px 2px",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={picked.includes(l.id)}
                      onChange={(e) =>
                        setPicked((current) =>
                          e.target.checked
                            ? [...current, l.id]
                            : current.filter((id) => id !== l.id),
                        )
                      }
                    />
                    {l.name}
                  </label>
                ))}
                {languages.length === 0 ? (
                  <span className="mono" style={{ fontSize: 11, color: "#5b6672" }}>
                    Keine Sprachen geladen — ELEVENLABS_API_KEY prüfen.
                  </span>
                ) : null}
              </div>

              <div style={{ height: 8 }} />
              <div style={{ display: "flex", gap: 8 }}>
                <Button
                  variant="ghost"
                  onClick={() => setPicked(suggest(languages))}
                >
                  Vorschlag
                </Button>
                <Button
                  variant="ghost"
                  onClick={() =>
                    // Deliberately a fresh draw each time: the whole appeal of
                    // "random" is that the next video is not this one again.
                    setPicked(
                      [...languages]
                        .sort(() => Math.random() - 0.5)
                        .slice(0, 7)
                        .map((l) => l.id),
                    )
                  }
                >
                  Zufällig
                </Button>
              </div>

              <div style={{ height: 10 }} />
              <textarea
                value={sentence}
                onChange={(e) => setSentence(e.target.value)}
                aria-label="Gesprochener Satz"
                rows={3}
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  border: "1px solid var(--grid)",
                  background: "#fff",
                  fontSize: 13,
                  lineHeight: 1.45,
                  resize: "vertical",
                }}
              />
              <div
                className="mono"
                style={{ fontSize: 11, color: "#5b6672", marginTop: 4 }}
              >
                Derselbe Satz in jeder Sprache — sonst rät man an der Länge.
              </div>

              <div style={{ height: 10 }} />
              <Button
                onClick={() => void generateLanguages()}
                disabled={busy || picked.length < 3}
              >
                {busy ? (step ?? "Wird erzeugt…") : "Sprach-Quiz erzeugen"}
              </Button>
              {error ? <Note tone="alert">{error}</Note> : null}
              {busy ? (
                <Note tone="info">
                  <span className="mono">
                    {Math.floor(elapsed / 60)}:
                    {String(elapsed % 60).padStart(2, "0")}
                  </span>{" "}
                  — eine Aufnahme pro Sprache, das dauert.
                </Note>
              ) : null}
              <Note tone="info">
                Kostet ElevenLabs-Zeichen: {picked.length} Aufnahmen à etwa{" "}
                {sentence.trim().length} Zeichen.
              </Note>
            </>
          ) : (
          <>
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
            max={50}
            value={count}
            onChange={(e) => setCount(Number(e.target.value))}
            style={{ width: "100%" }}
            aria-label="Anzahl Fragen"
          />

          {/*
            Reading the questions aloud.

            Set before generating rather than after, because it is the one
            option here that spends a budget with a monthly ceiling instead of
            a per-call price — and the estimate belongs next to the switch, not
            in a note somewhere further down.
          */}
          <div style={{ marginTop: 12, fontSize: 12 }}>
            <label
              style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}
            >
              <input
                type="checkbox"
                checked={narrate}
                onChange={(e) => setNarrate(e.target.checked)}
              />
              Fragen vorlesen
            </label>
            {narrate ? (
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  cursor: "pointer",
                  marginTop: 6,
                  marginLeft: 22,
                }}
              >
                <input
                  type="checkbox"
                  checked={narrateAnswers}
                  onChange={(e) => setNarrateAnswers(e.target.checked)}
                />
                Antwortmöglichkeiten mitlesen
              </label>
            ) : null}
          </div>
          {narrate ? (
            <div
              className="mono"
              style={{ fontSize: 11, color: "#5b6672", marginTop: 6 }}
            >
              Kostet grob {narrationEstimate.toLocaleString("de-DE")} Zeichen
              vom ElevenLabs-Kontingent. Gleiche Fragetexte werden nur einmal
              aufgenommen — bei „Welches Land ist das?" also einmal für das
              ganze Video.
            </div>
          ) : null}

          <div style={{ height: 10 }} />
          <Button onClick={() => void generate()} disabled={busy || topic.trim().length < 3}>
            {busy ? (step ?? "Fragen werden geschrieben…") : "Quiz erzeugen"}
          </Button>
          {error ? <Note tone="alert">{error}</Note> : null}
          {warning ? <Note tone="alert">{warning}</Note> : null}
          {busy ? (
            <Note tone="info">
              <span className="mono">
                {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")}
              </span>{" "}
              — läuft auf dem Server. Tab wechseln oder schließen ist in
              Ordnung. {count} Fragen brauchen ein bis drei Minuten.
            </Note>
          ) : null}
          </>
          )}
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
          {/*
            A display switch, not a regeneration. The wrong answers stay in the
            project either way, so this can be flipped on a finished quiz and
            flipped back without costing a single model call.
          */}
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "10px 12px",
              border: "1px solid var(--grid)",
              marginBottom: 10,
              cursor: "pointer",
              fontSize: 13,
            }}
          >
            <input
              type="checkbox"
              checked={project.showAnswers}
              onChange={(e) => {
                const showAnswers = e.target.checked;
                setProject((p) => ({ ...p, showAnswers }));
              }}
              style={{ width: 18, height: 18, cursor: "pointer" }}
            />
            <span>
              <strong>Antwortmöglichkeiten zeigen</strong>
              <br />
              <span className="mono" style={{ fontSize: 11, color: "#5b6672" }}>
                {project.showAnswers
                  ? "A · B · C zum Mitraten"
                  : "nur Frage und Auflösung — schwerer"}
              </span>
            </span>
          </label>

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

        <Panel
          step="03"
          title="Outro-Stimme"
          right={
            <span className="mono" style={{ fontSize: 11, color: "#5b6672" }}>
              {project.outroAudioUrl
                ? `${project.outroAudioSeconds?.toFixed(1) ?? "?"} s`
                : "fehlt"}
            </span>
          }
        >
          <textarea
            value={outroSpeech}
            onChange={(e) => {
              const next = e.target.value;
              // Changing the words invalidates the recording of the old ones.
              setProject((p) => ({
                ...p,
                outroSpeech: next,
                outroAudioUrl: undefined,
                outroAudioSeconds: undefined,
              }));
            }}
            aria-label="Gesprochenes Outro"
            rows={3}
            style={{
              width: "100%",
              padding: "10px 12px",
              border: "1px solid var(--grid)",
              background: "#fff",
              fontSize: 13,
              lineHeight: 1.45,
              resize: "vertical",
            }}
          />
          <div style={{ height: 8 }} />
          <Button
            onClick={() => void generateOutroVoice()}
            disabled={voiceBusy || outroSpeech.trim().length < 50}
          >
            {voiceBusy
              ? "Stimme wird aufgenommen…"
              : project.outroAudioUrl
                ? "Neu aufnehmen"
                : "Stimme aufnehmen"}
          </Button>
          {voiceError ? <Note tone="alert">{voiceError}</Note> : null}
          {voiceBusy ? (
            <Note tone="info">
              Läuft auf dem Server. Tab wechseln ist in Ordnung.
            </Note>
          ) : null}
          {project.outroAudioUrl && !voiceBusy ? (
            <>
              <audio
                src={project.outroAudioUrl}
                controls
                style={{ width: "100%", marginTop: 10 }}
              />
              <Note tone="live">
                Liegt über der Endkarte, die Musik tritt dafür zurück. Die Karte
                ist so lang wie der Satz.
              </Note>
            </>
          ) : (
            <Note tone="info">
              Ohne Aufnahme läuft die Endkarte stumm. Der Text hier wird
              gesprochen — nicht der auf dem Bildschirm.
            </Note>
          )}
        </Panel>

        <Panel step="04" title="Rendern">
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

        <ThumbnailPanel
          step="05"
          // The quiz's own flags, so the picture is of the thing in the video.
          flags={project.questions.map((q) => q.flag).filter((f): f is string => Boolean(f))}
          defaultTitle={project.title}
          topic={project.topic}
          slug={project.title
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "")
            .slice(0, 48)}
          config={project.thumbnail}
          onChange={(thumbnail) =>
            setProject((current) => ({ ...current, thumbnail }))
          }
        />
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
