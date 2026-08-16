"use client";

import { Player, type PlayerRef } from "@remotion/player";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { QuizProject, QuizQuestion, resolveQuizTiming } from "../lib/quiz";
import { isSpoken, narrationCost } from "../lib/quiz-narration";
import {
  DEFAULT_TEXT_MODEL,
  estimateCents,
  resolveTextModel,
  TEXT_MODELS,
} from "../lib/text-models";
import { QuizVideo } from "../remotion/quiz/QuizVideo";
import { getJson, postJson } from "./api";
import { DownloadButton } from "./DownloadButton";
import { RenderList, type ProjectRenderRow } from "./RenderList";
import { ThumbnailPanel } from "./ThumbnailPanel";
import { Button, formatTimecode, Note, Panel } from "./ui";

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

type QuizCost = {
  label: string;
  inputTokens: number;
  outputTokens: number;
  cents: number;
};

type QuizJobState = {
  status: "running" | "done" | "error";
  step?: string;
  project?: unknown;
  cost?: QuizCost;
  error?: string;
  /** Finished, but something optional did not — narration, usually. */
  warning?: string;
  startedAt?: number;
};

type QuizEditState = {
  status: "running" | "done" | "error";
  step?: string;
  questions?: unknown;
  warning?: string;
  error?: string;
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

/**
 * A price in US cents, the way a German reader expects to see one.
 *
 * US cents rather than converted euros: both providers bill in dollars, and a
 * euro figure printed here would go wrong the moment the rate moved — quietly,
 * in a place nobody would think to check.
 */
function formatCents(cents: number): string {
  const rounded = cents < 1 ? cents.toFixed(2) : cents.toFixed(1);
  return `${rounded.replace(".", ",")} US-Cent`;
}

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
  const [narrateReveal, setNarrateReveal] = useState(false);
  /** Which model writes the questions. See lib/text-models.ts. */
  const [modelId, setModelId] = useState(DEFAULT_TEXT_MODEL.id);
  const textModel = resolveTextModel(modelId);
  /** What the last finished generation actually cost. */
  const [cost, setCost] = useState<QuizCost | null>(null);

  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<string | null>(null);
  /** Set when a quiz finished but something optional did not. */
  const [warning, setWarning] = useState<string | null>(null);
  /** When the current generation started, so the wait can be shown as a number. */
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [jobId, setJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** Which questions are ticked for rewriting. */
  const [selected, setSelected] = useState<number[]>([]);
  const [editJobId, setEditJobId] = useState<string | null>(null);
  const [editKind, setEditKind] = useState<"requestion" | "narrate" | null>(null);
  const [editBusy, setEditBusy] = useState(false);
  const [editStep, setEditStep] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [editWarning, setEditWarning] = useState<string | null>(null);

  /**
   * What a narration run would cost from here, exactly.
   *
   * Not the estimate shown before generating — this one can see the questions,
   * so it counts identical texts once and charges nothing for a question that
   * already carries a recording of exactly these words.
   */
  const narrationPlan = useMemo(
    () => narrationCost(project.questions, { withReveal: narrateReveal }),
    [project.questions, narrateReveal],
  );
  const spokenCount = useMemo(
    () => project.questions.filter(isSpoken).length,
    [project.questions],
  );

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
    setCost(null);
    const result = await postJson<{ jobId: string }>("/api/quiz", {
      topic,
      count,
      model: modelId,
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

  // ---- Editing an existing quiz -------------------------------------------
  //
  // Both of these hand work to the server and wait for a new list of questions
  // to come back, so they share a job shape and the poller below.
  async function startEdit(
    kind: "requestion" | "narrate",
    path: string,
    body: Record<string, unknown>,
  ) {
    setEditBusy(true);
    setEditKind(kind);
    setEditError(null);
    setEditWarning(null);
    const result = await postJson<{ jobId: string }>(path, body);
    if (!result.ok) {
      setEditError(result.error);
      setEditBusy(false);
      setEditKind(null);
      return;
    }
    setEditJobId(result.data.jobId);
  }

  const requestion = () =>
    startEdit("requestion", "/api/quiz/requestion", {
      topic: project.topic,
      questions: project.questions,
      replace: selected,
      model: modelId,
    });

  const narrateNow = () =>
    startEdit("narrate", "/api/quiz/narrate", {
      questions: project.questions,
      withReveal: narrateReveal,
    });

  useEffect(() => {
    if (!editJobId || !editKind) return;
    const path =
      editKind === "narrate" ? "/api/quiz/narrate" : "/api/quiz/requestion";
    let cancelled = false;

    const tick = async () => {
      const result = await getJson<QuizEditState>(
        `${path}?jobId=${encodeURIComponent(editJobId)}`,
      );
      if (cancelled || !result.ok) return;
      setEditStep(result.data.step ?? null);
      if (result.data.status === "running") return;

      if (result.data.status === "done" && result.data.questions) {
        const parsed = QuizQuestion.array().safeParse(result.data.questions);
        if (parsed.success) {
          setProject((p) => ({ ...p, questions: parsed.data }));
          setSelected([]);
        } else {
          setEditError("Die geänderten Fragen passen nicht mehr zum Schema.");
        }
        setEditWarning(result.data.warning ?? null);
      } else {
        setEditError(result.data.error ?? "Der Auftrag ist fehlgeschlagen.");
      }
      setEditJobId(null);
      setEditKind(null);
      setEditBusy(false);
      setEditStep(null);
    };

    void tick();
    const id = window.setInterval(() => void tick(), 2000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [editJobId, editKind]);

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
      if (result.data.cost) setCost(result.data.cost);
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
          {/*
            Five rows rather than one.

            A topic is rarely three words. What actually gets typed here is a
            briefing — which countries, which era, what to avoid — and a single
            line hid all but the last few words of it, so it could not be read
            back or corrected. It scrolls rather than growing, so the panel
            below it stays where it was.
          */}
          <textarea
            value={topic}
            placeholder="z. B. Flaggen der Welt — gern mit Details: welche Regionen, welche Epoche, was vermieden werden soll."
            onChange={(e) => setTopic(e.target.value)}
            aria-label="Quiz-Thema"
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
            Which model writes the questions.

            The price sits on every option because the spread is fortyfold for
            the same job, and "write thirty questions as JSON" is exactly the
            kind of work where the cheap end is often enough. What is shown
            here is an estimate; what is shown after the run is measured.
          */}
          <select
            value={textModel.id}
            onChange={(e) => setModelId(e.target.value)}
            aria-label="Textmodell"
            style={{
              width: "100%",
              padding: "9px 10px",
              border: "1px solid var(--grid)",
              background: "#fff",
              fontSize: 13,
              marginTop: 12,
            }}
          >
            {TEXT_MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label} — ca. {formatCents(estimateCents(m, count))} für {count} Fragen
              </option>
            ))}
          </select>
          <div className="mono" style={{ fontSize: 11, color: "#5b6672", marginTop: 4 }}>
            {textModel.note} {textModel.inputPerM.toFixed(2).replace(".", ",")} $
            /Mio. Eingabe, {textModel.outputPerM.toFixed(2).replace(".", ",")} $
            /Mio. Ausgabe.
          </div>

          {/*
            No "read the questions aloud" switch here any more.

            It used to sit next to the model, and it was the wrong place for
            it: it spent voice credits before anybody had read a single
            question, so every question that was then rewritten had to be paid
            for a second time. Speaking is now its own step further down, after
            the questions exist and can be judged — same price, nothing wasted.
          */}
          <div style={{ height: 10 }} />
          <Button onClick={() => void generate()} disabled={busy || topic.trim().length < 3}>
            {busy ? (step ?? "Fragen werden geschrieben…") : "Quiz erzeugen"}
          </Button>
          {error ? <Note tone="alert">{error}</Note> : null}
          {warning ? <Note tone="alert">{warning}</Note> : null}
          {cost ? (
            <Note tone="info">
              <span className="mono">
                {formatCents(cost.cents)} — {cost.label},{" "}
                {cost.inputTokens.toLocaleString("de-DE")} Token rein,{" "}
                {cost.outputTokens.toLocaleString("de-DE")} raus
              </span>{" "}
              — gemessen, nicht geschätzt.
            </Note>
          ) : null}
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
          {/*
            The whole list, and the whole of every question.

            It used to show the correct answer alone, inside 280 pixels of
            scroll — so a quiz about video games read "01 easy · Clash of
            Clans" thirty times over and there was no way to check a single
            question without rendering the video. The question, its three
            options and which one wins are the only things worth looking at
            here, and there are never more than fifty of them.
          */}
          <div style={{ display: "grid", gap: 6 }}>
            {project.questions.map((q, i) => {
              const chosen = selected.includes(i);
              return (
                <div
                  key={q.id}
                  style={{
                    border: `1px solid ${chosen ? "var(--ink)" : "var(--grid)"}`,
                    background: chosen ? "rgba(0,0,0,0.03)" : "transparent",
                    padding: "8px 10px",
                    fontSize: 12,
                    lineHeight: 1.4,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "baseline",
                      gap: 8,
                      marginBottom: 3,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={chosen}
                      onChange={(e) =>
                        setSelected((current) =>
                          e.target.checked
                            ? [...current, i].sort((a, b) => a - b)
                            : current.filter((n) => n !== i),
                        )
                      }
                      aria-label={`Frage ${i + 1} auswählen`}
                      style={{ cursor: "pointer" }}
                    />
                    <span className="mono" style={{ color: "#5b6672", fontSize: 11 }}>
                      {String(i + 1).padStart(2, "0")} {q.level}
                      {q.flag ? ` · ${q.flag.toUpperCase()}` : ""}
                      {q.audioUrl
                        ? ` · ♪ ${q.audioSeconds?.toFixed(1) ?? "?"}s`
                        : ""}
                    </span>
                    <button
                      onClick={() => {
                        const slot = timing.slots[i];
                        if (slot) playerRef.current?.seekTo(slot.from + 10);
                      }}
                      title="Zu dieser Frage springen"
                      style={{
                        marginLeft: "auto",
                        border: "none",
                        background: "none",
                        cursor: "pointer",
                        color: "#5b6672",
                        fontSize: 11,
                      }}
                    >
                      ▶
                    </button>
                  </div>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>{q.prompt}</div>
                  <div style={{ display: "grid", gap: 2 }}>
                    {q.answers.map((answer, n) => (
                      <div
                        key={n}
                        style={{
                          color: n === q.correctIndex ? "var(--live)" : "#5b6672",
                          fontWeight: n === q.correctIndex ? 700 : 400,
                        }}
                      >
                        <span className="mono">{"ABC"[n]}</span> {answer}
                        {n === q.correctIndex ? " ✓" : ""}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          {/* ---- Rewriting ---- */}
          <div
            style={{
              display: "flex",
              gap: 8,
              alignItems: "center",
              marginTop: 10,
              flexWrap: "wrap",
            }}
          >
            <Button
              onClick={() => void requestion()}
              disabled={editBusy || selected.length === 0}
            >
              {editBusy && editKind === "requestion"
                ? (editStep ?? "wird neu geschrieben…")
                : `${selected.length || ""} ${
                    selected.length === 1 ? "Frage" : "Fragen"
                  } neu erzeugen`.trim()}
            </Button>
            {selected.length > 0 ? (
              <button
                onClick={() => setSelected([])}
                style={{
                  border: "none",
                  background: "none",
                  cursor: "pointer",
                  fontSize: 12,
                  color: "#5b6672",
                }}
              >
                Auswahl aufheben
              </button>
            ) : (
              <span className="mono" style={{ fontSize: 11, color: "#5b6672" }}>
                Fragen ankreuzen, um sie zu ersetzen — höchstens zehn auf einmal.
              </span>
            )}
          </div>

          {/* ---- Voice, after the fact ---- */}
          <div
            style={{
              marginTop: 12,
              paddingTop: 10,
              borderTop: "1px solid var(--grid)",
            }}
          >
            <label
              style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, cursor: "pointer" }}
            >
              <input
                type="checkbox"
                checked={narrateReveal}
                onChange={(e) => setNarrateReveal(e.target.checked)}
              />
              Auflösung vorlesen — „Richtig ist: …", wenn die Zeit um ist
            </label>
            <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
              <Button
                onClick={() => void narrateNow()}
                // Nothing to say means nothing to send. Without this the
                // button would happily start a job that records zero clips.
                disabled={editBusy || narrationPlan.characters === 0}
              >
                {editBusy && editKind === "narrate"
                  ? (editStep ?? "wird vertont…")
                  : narrationPlan.characters === 0
                    ? "Alle Fragen vertont"
                    : spokenCount > 0
                      ? "Fehlende vertonen"
                      : "Fragen vertonen"}
              </Button>
              {spokenCount > 0 ? (
                <Button
                  variant="ghost"
                  onClick={() =>
                    setProject((p) => ({
                      ...p,
                      questions: p.questions.map((q) => ({
                        ...q,
                        audioUrl: undefined,
                        audioSeconds: undefined,
                        audioText: undefined,
                        // The answer goes with it. A quiz that says "Richtig
                        // ist: Japan" over a question nobody read out is worse
                        // than a silent one.
                        revealAudioUrl: undefined,
                        revealAudioSeconds: undefined,
                        revealAudioText: undefined,
                      })),
                    }))
                  }
                >
                  Stimme entfernen
                </Button>
              ) : null}
            </div>
            <div className="mono" style={{ fontSize: 11, color: "#5b6672", marginTop: 6 }}>
              {spokenCount} von {project.questions.length} Fragen vertont
              {narrationPlan.characters > 0
                ? ` · nächster Lauf kostet ${narrationPlan.characters.toLocaleString("de-DE")} Zeichen (${narrationPlan.unique} ${
                    narrationPlan.unique === 1 ? "Aufnahme" : "Aufnahmen"
                  })`
                : " · nichts zu tun"}
            </div>
            {editError ? <Note tone="alert">{editError}</Note> : null}
            {editWarning ? <Note tone="alert">{editWarning}</Note> : null}
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
