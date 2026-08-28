"use client";

import { Player, type PlayerRef } from "@remotion/player";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IMAGE_MODELS, resolveModel } from "../lib/image-models";
import {
  DEFAULT_SPEECH_MODEL_ID,
  resolveSpeechModel,
  SPEECH_MODELS,
} from "../lib/speech-models";
import {
  DEFAULT_YOUTUBE_MODEL,
  renderDescription,
  resolveStoryTiming,
  shortSeconds,
  storyTakes,
  StoryProject,
  YoutubeListing,
  type StoryCharacter,
  type StoryProject as Story,
  type StoryStyle,
} from "../lib/story";
import { WORDS_PER_MINUTE } from "../lib/story-prompt";
import { TEXT_MODELS } from "../lib/text-models";
import { hasDisclaimer, withDisclaimer } from "../lib/finance";
import { SHORTS_PER_FILM } from "../lib/story-shorts";
import { soundCost } from "../lib/sfx-cost";
import { subtitleCues, subtitleFilename, toSrt } from "../lib/subtitles";
import { StoryVideo } from "../remotion/story/StoryVideo";
import { FinanceVideo } from "../remotion/finance/FinanceVideo";
import { getJson, postJson } from "./api";
import { DownloadButton } from "./DownloadButton";
import { LibraryPanel } from "./LibraryPanel";
import { RenderList, type ProjectRenderRow } from "./RenderList";
import { ThumbnailPanel } from "./ThumbnailPanel";
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

/**
 * The jobs that outlive the tab.
 *
 * Writing the script already survived a reload; drawing, sound and voice did
 * not, and that is where the losses were. All three start work on the server,
 * hand back an id, and deliver their result only to whoever polls for it - so
 * a phone that locks its screen mid-draw leaves a finished job sitting in
 * storage that nobody will ever read. Forty-one pictures were paid for and
 * lost exactly this way.
 *
 * The project id is stored beside the job id so a resumed job cannot be
 * applied to a different video than the one it belongs to.
 */
const DRAW_KEY = "infographics-studio.storyDrawJob";
const SFX_KEY = "infographics-studio.storySfxJob";
const VOICE_KEY = "infographics-studio.storyVoiceJob";
const SHORTS_KEY = "infographics-studio.storyShortsJob";

/**
 * How long a remembered job is worth picking up again.
 *
 * Every one of these routes is capped at three hundred seconds, so a job
 * remembered ten minutes ago has either finished or died - and a dead one that
 * is resumed anyway is worse than forgotten. It comes back on every page load,
 * marks its step busy, polls a job that is gone, gives up, and is still
 * remembered for next time. The control it belongs to is then permanently
 * unavailable, which for the voice meant the recording could never be made and
 * the panel simply said it was missing.
 *
 * An expiry rather than only a careful cleanup, because cleanup has to be
 * right on every path and this is right on all of them at once.
 */
const JOB_MEMORY_MS = 10 * 60 * 1000;

/** Remember a running job, or forget it when it is done. */
function rememberJob(key: string, jobId: string | null, projectId?: string) {
  try {
    if (jobId) {
      window.localStorage.setItem(
        key,
        `${jobId}|${projectId ?? ""}|${Date.now()}`,
      );
    } else {
      window.localStorage.removeItem(key);
    }
  } catch {
    // The job still runs on the server; only picking it up again is lost.
  }
}

/** A remembered job, if there is one and it is still worth resuming. */
function recallJob(key: string): { jobId: string; projectId: string } | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const [jobId, projectId = "", at = ""] = raw.split("|");
    if (!jobId) return null;

    // Entries written before this carried a timestamp have none. Treated as
    // expired rather than trusted: they are by definition older than this
    // deploy, so nothing they name can still be running.
    const started = Number(at);
    if (!Number.isFinite(started) || Date.now() - started > JOB_MEMORY_MS) {
      window.localStorage.removeItem(key);
      return null;
    }
    return { jobId, projectId };
  } catch {
    return null;
  }
}
const TOLERATED_POLL_FAILURES = 3;

/** Shots a minute of film holds, at the eight words a shot the writer aims for. */
const SHOTS_PER_MINUTE = WORDS_PER_MINUTE / 8;

type StoryJobState = {
  status: "running" | "done" | "error";
  step?: string;
  project?: unknown;
  error?: string;
  /** Finished, but shorter than asked for. See lib/story-pipeline.ts. */
  warning?: string;
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

/** A look kept for reuse. See lib/looks.ts. */
type Look = { id: string; label: string; style: StoryStyle; uses: number };

/** A figure kept for reuse. See lib/characters.ts. */
type Saved = { key: string; name: string; description: string; uses: number };

/** The cast being assembled for the NEXT film, before it is written. */
type Seed = { key: string; name: string; description: string };

type VoiceRow = {
  voiceId: string;
  name: string;
  category?: string;
  labels?: Record<string, string>;
  languages?: string[];
  models?: string[];
};

type Summary = {
  id: string;
  title: string;
  topic: string;
  format: "infographics" | "quiz" | "video";
  updatedAt: number;
  detail: string;
  renderUrl?: string;
  pendingRenders: number;
};

function ago(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return "gerade eben";
  const m = Math.round(s / 60);
  if (m < 60) return `vor ${m} Min`;
  const h = Math.round(m / 60);
  return h < 24 ? `vor ${h} Std` : `vor ${Math.round(h / 24)} Tagen`;
}

const formatCents = (cents: number) =>
  cents >= 100
    ? `${(cents / 100).toFixed(2).replace(".", ",")} $`
    : `${cents.toFixed(cents < 1 ? 2 : 1).replace(".", ",")} US-Cent`;

export const VideoStudio: React.FC<{
  seed: Story;
  /**
   * Welches der beiden sprachgetakteten Formate hier bearbeitet wird.
   *
   * Ein Schalter statt einer zweiten Komponente, weil sich die beiden erst
   * hinter dem Skript unterscheiden: Stimme, Klang, Rendern, Shorts,
   * Untertitel, Thumbnail, YouTube und das Speichern sind Zeile für Zeile
   * dasselbe. Verzweigt wird an vier Stellen — Erzeugen, Vorschau, die
   * Bildtafeln und die Projektliste.
   */
  format?: "video" | "finanz";
}> = ({ seed, format = "video" }) => {
  const finance = format === "finanz";
  /** Getrennte Speicherschlüssel, damit die Reiter sich nicht überschreiben. */
  const jobKey = finance ? `${JOB_KEY}.finanz` : JOB_KEY;
  const projectKey = finance ? `${PROJECT_KEY}.finanz` : PROJECT_KEY;
  const [project, setProject] = useState<Story>(seed);
  const [topic, setTopic] = useState("");
  const [minutes, setMinutes] = useState(5);
  /**
   * The picture rate, not the picture count.
   *
   * The count was the wrong knob: sixty pictures is generous for a five minute
   * film and threadbare for a twenty-five minute one, so moving the length
   * slider silently changed how often a viewer sees the same drawing. A rate
   * holds that constant, and the budget the writer is given follows from it.
   */
  const [imagesPerMinute, setImagesPerMinute] = useState(4);
  const imageBudget = Math.min(
    400,
    Math.max(4, Math.round(imagesPerMinute * minutes)),
  );
  /**
   * How often each picture would have to appear at this rate.
   *
   * Derived, not guessed: the writer aims at eight words a shot and the voice
   * reads WORDS_PER_MINUTE, so a minute holds about twenty shots. Divided by
   * the pictures in that minute, this is the number of separate times a viewer
   * sees the same drawing - and past three, that is what they notice instead
   * of the film.
   */
  const appearances = SHOTS_PER_MINUTE / Math.max(0.5, imagesPerMinute);
  const [imageModelId, setImageModelId] = useState("gemini-3.1-flash-lite-image");
  const imageModel = resolveModel(imageModelId);

  /**
   * Which model writes the script.
   *
   * The quiz format has had this choice since it existed; the video format was
   * pinned to Gemini 3.7 Flash because that is what it was built against. But
   * the script is the one part of a video that cannot be repaired later - a
   * flat script produces a flat film however good the pictures are - and it is
   * also by far the cheapest part to redo. Twenty-five cents against three
   * dollars of drawings, so it is exactly the place where paying more is worth
   * considering.
   */
  const [textModelId, setTextModelId] = useState("gemini-3.7-flash");

  /**
   * Whether to look the facts up before writing.
   *
   * On by default. The format wrote from memory for its whole life, which
   * produces prose that reads well and says nothing checkable - fine for the
   * Ice Age, useless for a topic made of dates and patch numbers. Switchable
   * because research costs eighty seconds and a few cents, and some topics
   * genuinely do not need it.
   */
  const [research, setResearch] = useState(true);
  /**
   * Wie der Zuschauer im Film steht. Siehe StoryPerspective.
   *
   * Vorgabe ist das Erklärstück, weil das zu jedem Thema passt. "Du bist
   * dabei" braucht Menschen, denen etwas zustößt — bei einem Thema ohne die
   * klingt es aufgesetzt.
   */
  const [perspective, setPerspective] = useState<"erklaerung" | "erlebnis">(
    "erklaerung",
  );

  // ---- What the look should be, before there is one -----------------------
  const [styleWish, setStyleWish] = useState("");
  const [lookId, setLookId] = useState("");
  const [looks, setLooks] = useState<Look[]>([]);
  const [lookNote, setLookNote] = useState<string | null>(null);

  const [saved, setSaved] = useState<Saved[]>([]);
  const [cast, setCast] = useState<Seed[]>([]);

  // ---- Who reads it -------------------------------------------------------
  const [voices, setVoices] = useState<VoiceRow[]>([]);
  const [voiceId, setVoiceId] = useState("");
  const [speechModelId, setSpeechModelId] = useState(DEFAULT_SPEECH_MODEL_ID);
  const [languages, setLanguages] = useState<{ id: string; name: string }[]>([]);
  const [language, setLanguage] = useState("de");
  const speechModel = resolveSpeechModel(speechModelId);
  const chosenVoice = voices.find((v) => v.voiceId === voiceId);

  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cost, setCost] = useState<StoryJobState["cost"] | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);

  const [drawJobId, setDrawJobId] = useState<string | null>(null);
  const [drawBusy, setDrawBusy] = useState(false);
  const [drawStep, setDrawStep] = useState<string | null>(null);
  const [drawNote, setDrawNote] = useState<string | null>(null);
  const [drawError, setDrawError] = useState<string | null>(null);

  const [sfxJobId, setSfxJobId] = useState<string | null>(null);
  const [sfxBusy, setSfxBusy] = useState(false);
  const [sfxStep, setSfxStep] = useState<string | null>(null);
  const [sfxNote, setSfxNote] = useState<string | null>(null);
  const [sfxError, setSfxError] = useState<string | null>(null);

  const [shortsJobId, setShortsJobId] = useState<string | null>(null);
  /**
   * Welches Modell den Upload-Text schreibt.
   *
   * Nicht das, das den Film geschrieben hat: hier wird zusammengefasst, was
   * schon dasteht, und dafür reicht das kleinste Modell. Ein Opus-Lauf würde
   * für zweihundert Wörter das Zwanzigfache kosten und nichts besser machen.
   */
  const [youtubeModelId, setYoutubeModelId] = useState(DEFAULT_YOUTUBE_MODEL);
  const [youtubeBusy, setYoutubeBusy] = useState(false);
  const [youtubeError, setYoutubeError] = useState<string | null>(null);
  const [youtubeNote, setYoutubeNote] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const [shortsBusy, setShortsBusy] = useState(false);
  const [shortsStep, setShortsStep] = useState<string | null>(null);
  const [shortsNote, setShortsNote] = useState<string | null>(null);
  const [shortsError, setShortsError] = useState<string | null>(null);

  const [voiceJobId, setVoiceJobId] = useState<string | null>(null);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [voiceNote, setVoiceNote] = useState<string | null>(null);

  const [projectId, setProjectId] = useState<string | null>(null);
  const [projects, setProjects] = useState<Summary[]>([]);
  const [renders, setRenders] = useState<ProjectRenderRow[]>([]);
  /**
   * What the last save actually did.
   *
   * "failed" exists because its absence cost a recording. A save that did not
   * work set the state back to "idle", said nothing, and was never retried -
   * and the header, which showed "gespeichert" for any project that had an id,
   * went on claiming the work was safe. The voice stayed in the browser, the
   * render used it, the video came out with it, and the next page load read
   * storage and found nothing.
   */
  const [saveState, setSaveState] = useState<
    "idle" | "saving" | "saved" | "failed"
  >("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  /** Retries so far, so the backoff grows instead of hammering. */
  const saveAttempt = useRef(0);
  const [render, setRender] = useState<{
    renderId: string;
    status: string;
    progress: number;
    phase?: string;
    outputUrl?: string;
    error?: string;
    /** Which short this render belongs to, when it is not the film. */
    shortId?: string;
  } | null>(null);

  const playerRef = useRef<PlayerRef>(null);
  const lastSaved = useRef<string | null>(null);

  /**
   * Panel numbers, counted rather than typed in.
   *
   * The facts panel only exists when there was research, so every panel after
   * it moves by one. Hardcoded numbers collided the moment it was added -
   * there were briefly two panels called 03 - and would collide again at the
   * next insertion.
   */
  const panelStep = (n: number) =>
    String(
      n +
        (project.research ? 1 : 0) -
        // Stil, Bilder und Shorts fehlen beim Finanz-Format, also rutscht
        // alles danach auf. Gezählt statt eingetippt, damit die Nummern
        // lückenlos bleiben, wenn wieder etwas dazukommt.
        (finance ? [2, 3].filter((skipped) => skipped < n).length : 0),
    ).padStart(2, "0");

  const timing = useMemo(() => resolveStoryTiming(project), [project]);
  // What the screen actually shows: consecutive sentences on one picture are
  // one continuous appearance, not several cuts to the same image.
  const takes = useMemo(() => storyTakes(timing), [timing]);

  /**
   * The video to offer for download.
   *
   * The render in flight wins; otherwise the newest one storage knows about.
   * That second source is what makes walking away from a render safe — a file
   * that finished while the tab was closed is still findable afterwards,
   * which is the whole reason the project keeps a list of its renders.
   */
  const finishedVideo = useMemo(() => {
    if (render?.status === "done" && render.outputUrl && !render.shortId) {
      return { url: render.outputUrl, sizeBytes: undefined as number | undefined };
    }
    // The film, never one of its vertical cuts. A short is also a finished
    // render with a file, and offering the newest of those would hand somebody
    // a sixty-second clip when they asked for their eight-minute video.
    const newest = renders
      .filter((r) => r.outputUrl && !r.shortId)
      .sort((a, b) => b.at - a.at)[0];
    return newest?.outputUrl
      ? { url: newest.outputUrl, sizeBytes: newest.sizeBytes }
      : null;
  }, [render?.status, render?.outputUrl, renders]);
  const undrawn = useMemo(
    () => project.images.filter((i) => !i.url),
    [project.images],
  );
  const drawnCount = project.images.length - undrawn.length;

  // ---- The kept things ----------------------------------------------------
  /**
   * Beide mit Rückfall auf die leere Liste.
   *
   * Nicht Vorsicht um der Vorsicht willen: eine Antwort mit Status 200, der
   * das erwartete Feld fehlt, hat das GANZE Studio weiß werden lassen —
   * beide Reiter, alle Tafeln, ein `undefined.map()` in der ersten Zeile des
   * Aufbaus. Eine fehlende Stilliste ist ein Auswahlkasten weniger, kein
   * Grund, ein Video unerreichbar zu machen.
   */
  const refreshLooks = useCallback(async () => {
    const result = await getJson<{ looks?: Look[] }>("/api/story/looks");
    if (result.ok) setLooks(result.data.looks ?? []);
  }, []);

  const refreshSaved = useCallback(async () => {
    const result = await getJson<{ characters?: Saved[] }>(
      "/api/story/characters",
    );
    if (result.ok) setSaved(result.data.characters ?? []);
  }, []);

  useEffect(() => {
    void refreshLooks();
    void refreshSaved();
  }, [refreshLooks, refreshSaved]);

  // The voice list, and the languages of whichever model is selected. Both are
  // conveniences: without either, the route still falls back to the configured
  // voice and lets the model guess the language, which is what it did before
  // there was anything to pick.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await getJson<{
        voices: VoiceRow[];
        defaultVoiceId: string | null;
      }>("/api/story/voice");
      if (cancelled || !result.ok) return;
      setVoices(result.data.voices ?? []);
      setVoiceId((current) => current || result.data.defaultVoiceId || "");
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await getJson<{ languages: { id: string; name: string }[] }>(
        `/api/languages?model=${encodeURIComponent(speechModelId)}`,
      );
      if (!cancelled && result.ok) setLanguages(result.data.languages ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [speechModelId]);

  // ---- Autosave -----------------------------------------------------------
  const refreshProjects = useCallback(async () => {
    const result = await getJson<{ projects?: Summary[] }>("/api/projects");
    if (result.ok) {
      setProjects(
        (result.data.projects ?? []).filter((p) => p.format === format),
      );
    }
  }, [format]);

  const save = useCallback(async () => {
    const payload = JSON.stringify(project);
    setSaveState("saving");
    const result = await postJson<{ id: string }>("/api/projects", {
      id: projectId ?? undefined,
      title: project.title,
      project,
    });
    if (!result.ok) {
      saveAttempt.current += 1;
      setSaveState("failed");
      setSaveError(result.error);
      return;
    }
    saveAttempt.current = 0;
    lastSaved.current = payload;
    setProjectId(result.data.id);
    setSaveState("saved");
    setSaveError(null);
    try {
      window.localStorage.setItem(projectKey, result.data.id);
    } catch {
      // Not being able to remember the id costs a save, not the work.
    }
    void refreshProjects();
  }, [project, projectId, refreshProjects]);

  /**
   * Try a failed save again.
   *
   * Its own effect, and it has to be: the autosave above only runs when the
   * project changes, and a project stops changing exactly when it is finished
   * — which is the worst possible moment to give up on saving it. Nothing else
   * would ever come back for it.
   *
   * Longer after each failure, and it stops itself: the moment save() begins
   * it sets "saving", this effect sees a state that is no longer "failed" and
   * clears its own timer, so there is never a second attempt in flight beside
   * the first.
   */
  useEffect(() => {
    if (saveState !== "failed") return;
    const wait = Math.min(30_000, 3_000 * 2 ** (saveAttempt.current - 1));
    const id = window.setTimeout(() => void save(), wait);
    return () => window.clearTimeout(id);
  }, [saveState, save]);

  /**
   * Open a saved video.
   *
   * Without this the format had no way back to its own work: it saved
   * diligently and offered no door. A reload showed the empty seed, and the
   * pictures somebody had paid three dollars for were reachable only by
   * knowing a URL nobody was shown.
   */
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
    const parsed = StoryProject.safeParse(result.data.project);
    if (!parsed.success) {
      setError("Dieses Projekt ist kein Video.");
      return;
    }
    lastSaved.current = JSON.stringify(parsed.data);
    setProject(parsed.data);
    setProjectId(result.data.id);
    setTopic(parsed.data.topic);
    setRenders(result.data.renders ?? []);
    setRender(null);
    setError(null);
    setSaveState("saved");
    try {
      window.localStorage.setItem(projectKey, result.data.id);
    } catch {
      // The project is open either way.
    }
  }, []);

  useEffect(() => {
    void refreshProjects();
  }, [refreshProjects]);

  // Reopen whatever was last worked on. A reload used to land on the empty
  // seed even though the work was safely stored.
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(projectKey);
      if (stored) void loadProject(stored);
    } catch {
      // Starting on the seed is a fine answer.
    }
  }, [loadProject]);

  useEffect(() => {
    const payload = JSON.stringify(project);
    if (lastSaved.current === payload) return;
    if (!projectId && payload === JSON.stringify(seed)) return;

    const id = window.setTimeout(() => void save(), 1200);
    return () => window.clearTimeout(id);
  }, [project, projectId, save, seed]);

  // ---- Keeping a figure or a look ----------------------------------------
  async function keepCharacter(seed: Seed) {
    setLookNote(null);
    const result = await postJson<{ character: Saved }>(
      "/api/story/characters",
      { key: seed.key || undefined, name: seed.name, description: seed.description },
    );
    if (!result.ok) {
      setLookNote(result.error);
      return;
    }
    // The key comes back from the server, which is what makes a figure the
    // same figure across films: the studio never invents one.
    const kept = result.data.character;
    setCast((list) =>
      list.map((c) => (c === seed ? { ...c, key: kept.key } : c)),
    );
    setLookNote(`„${kept.name}“ gemerkt.`);
    await refreshSaved();
  }

  async function keepLook() {
    setLookNote(null);
    const result = await postJson<{ look: Look }>("/api/story/looks", {
      label: project.style.name,
      style: project.style,
    });
    if (!result.ok) {
      setLookNote(result.error);
      return;
    }
    setLookNote(
      `„${result.data.look.label}“ gemerkt. Das nächste Video kann oben damit anfangen.`,
    );
    await refreshLooks();
  }

  /**
   * Forget every drawing, keeping the list.
   *
   * What makes an edited style worth editing — nothing else redraws, because
   * the drawing step only ever touches pictures with no url. Behind a
   * confirmation because it is the one control here that turns a free edit
   * into a real bill.
   */
  function discardImages() {
    const price = formatCents(project.images.length * imageModel.cents);
    if (
      !window.confirm(
        `Alle ${project.images.length} Bilder verwerfen? Neu zeichnen kostet ${price} — außer für Motive, die schon in der Bibliothek liegen.`,
      )
    ) {
      return;
    }
    setProject((p) => ({
      ...p,
      images: p.images.map((i) => ({
        ...i,
        url: undefined,
        model: undefined,
        reused: undefined,
      })),
    }));
  }

  // ---- Writing ------------------------------------------------------------
  async function generate() {
    setBusy(true);
    setError(null);
    setCost(null);
    setWarning(null);
    const result = await postJson<{ jobId: string }>(
      finance ? "/api/finance" : "/api/story",
      finance
        ? { topic, minutes, model: textModelId, research }
        : {
      topic,
      minutes,
      imageBudget,
      imagesPerMinute,
      // Ignored by the route when a look is chosen — a kept look is already a
      // decision, and asking for both would be asking for two.
      styleWish: lookId ? undefined : styleWish.trim() || undefined,
      lookId: lookId || undefined,
      characters: cast.filter((c) => c.description.trim().length >= 3),
      model: textModelId,
      research,
      perspective,
          },
    );
    if (!result.ok) {
      setError(result.error);
      setBusy(false);
      return;
    }
    try {
      window.localStorage.setItem(jobKey, result.data.jobId);
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
        `${finance ? "/api/finance" : "/api/story"}?jobId=${encodeURIComponent(jobId)}`,
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
      setWarning(result.data.warning ?? null);
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
        window.localStorage.removeItem(jobKey);
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
      const stored = window.localStorage.getItem(jobKey);
      if (stored) setJobId(stored);
    } catch {
      // Starting fresh is a fine answer.
    }
  }, []);

  /**
   * Pick up drawing, sound and voice again after a reload.
   *
   * These three used to exist only in React state, so closing the tab threw
   * away the only handle on work that was already running and already paid
   * for. The job itself never noticed - it finished on the server and wrote
   * its result, and nobody came back for it.
   */
  useEffect(() => {
    const draw = recallJob(DRAW_KEY);
    if (draw) {
      setDrawJobId(draw.jobId);
      setDrawBusy(true);
    }
    const sfx = recallJob(SFX_KEY);
    if (sfx) {
      setSfxJobId(sfx.jobId);
      setSfxBusy(true);
    }
    const voice = recallJob(VOICE_KEY);
    if (voice) {
      setVoiceJobId(voice.jobId);
      setVoiceBusy(true);
    }
    const shorts = recallJob(SHORTS_KEY);
    if (shorts) {
      setShortsJobId(shorts.jobId);
      setShortsBusy(true);
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
    rememberJob(DRAW_KEY, result.data.jobId, project.id);
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
          rememberJob(DRAW_KEY, null);
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
        // Applied only to the video it belongs to. A job picked up after a
        // reload may finish while a different project is open, and silently
        // replacing that one would be worse than losing the result.
        if (parsed.success) {
          setProject((current) =>
            parsed.data.id === current.id ? parsed.data : current,
          );
        }
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
      rememberJob(DRAW_KEY, null);
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

  // ---- Sound design -------------------------------------------------------
  async function makeSounds() {
    setSfxBusy(true);
    setSfxError(null);
    setSfxNote(null);
    const result = await postJson<{ jobId: string }>("/api/story/sounds", {
      project,
    });
    if (!result.ok) {
      setSfxError(result.error);
      setSfxBusy(false);
      return;
    }
    rememberJob(SFX_KEY, result.data.jobId, project.id);
    setSfxJobId(result.data.jobId);
  }

  useEffect(() => {
    if (!sfxJobId) return;
    let cancelled = false;
    let failures = 0;

    const tick = async () => {
      const result = await getJson<{
        status: string;
        step?: string;
        project?: unknown;
        error?: string;
        warning?: string;
        made?: number;
        reused?: number;
        characters?: number;
      }>(`/api/story/sounds?jobId=${encodeURIComponent(sfxJobId)}`);
      if (cancelled) return;
      if (!result.ok) {
        failures += 1;
        if (failures > TOLERATED_POLL_FAILURES) {
          rememberJob(SFX_KEY, null);
          setSfxError(result.error);
          setSfxBusy(false);
          setSfxJobId(null);
        }
        return;
      }
      failures = 0;
      setSfxStep(result.data.step ?? null);
      if (result.data.status === "running") return;

      if (result.data.status === "done" && result.data.project) {
        const parsed = StoryProject.safeParse(result.data.project);
        if (parsed.success) {
          setProject((current) =>
            parsed.data.id === current.id ? parsed.data : current,
          );
        }
        const free = result.data.reused ?? 0;
        setSfxNote(
          `${result.data.made ?? 0} erzeugt für ${(result.data.characters ?? 0).toLocaleString("de-DE")} Zeichen` +
            (free > 0 ? `, ${free} aus der Bibliothek — kostenlos.` : "."),
        );
        if (result.data.warning) setSfxError(result.data.warning);
      } else {
        setSfxError(result.data.error ?? "Die Geräusche konnten nicht erzeugt werden.");
      }
      rememberJob(SFX_KEY, null);
      setSfxJobId(null);
      setSfxStep(null);
      setSfxBusy(false);
    };

    void tick();
    const id = window.setInterval(() => void tick(), 2500);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [sfxJobId]);

  // ---- Voice --------------------------------------------------------------
  async function speak() {
    setVoiceBusy(true);
    setVoiceError(null);
    setVoiceNote(null);
    const result = await postJson<{ jobId: string }>("/api/story/voice", {
      project,
      voice: voiceId || undefined,
      voiceLabel: chosenVoice?.name,
      model: speechModelId,
      language: speechModel.language ? language : undefined,
    });
    if (!result.ok) {
      setVoiceError(result.error);
      setVoiceBusy(false);
      return;
    }
    rememberJob(VOICE_KEY, result.data.jobId, project.id);
    setVoiceJobId(result.data.jobId);
  }

  useEffect(() => {
    if (!voiceJobId) return;
    let cancelled = false;
    let failures = 0;
    const tick = async () => {
      const result = await getJson<{
        status: string;
        audioUrl?: string;
        cues?: number[];
        audioSeconds?: number;
        characters?: number;
        voice?: string;
        voiceLabel?: string;
        model?: string;
        modelLabel?: string;
        language?: string;
        error?: string;
      }>(`/api/story/voice?jobId=${encodeURIComponent(voiceJobId)}`);
      if (cancelled) return;
      if (!result.ok) {
        // A job document carrying an "error" field is read by getJson as a
        // failed call — which is right, and was being dropped on the floor
        // here. So a recording that was refused in milliseconds left the
        // button saying "wird gesprochen…" forever, with the reason sitting
        // unread in the job. Same rule as the other pollers: ride out a blip,
        // report a wall.
        failures += 1;
        if (failures > TOLERATED_POLL_FAILURES) {
          // Forgotten here too, not only on success. A job that ends badly and
          // stays remembered is resumed by every later page load: the studio
          // comes up saying "wird gesprochen…", disables the button, polls a
          // job that is dead or long swept away, gives up, and remembers it
          // again for next time. The recording can then never be made at all,
          // and the panel says the voice is missing — which it is, because the
          // one control that would produce it is permanently busy.
          rememberJob(VOICE_KEY, null);
          setVoiceError(result.error);
          setVoiceJobId(null);
          setVoiceBusy(false);
        }
        return;
      }
      failures = 0;
      if (result.data.status === "running") return;

      if (result.data.status === "done" && result.data.audioUrl) {
        const data = result.data;
        // Which video this take belongs to, remembered when it was started.
        // A recording is the most expensive thing here to lose and the only
        // one that cannot be found again from storage - the file is named
        // after a random job id - so it must not be attached to the wrong
        // project either.
        const belongsTo = recallJob(VOICE_KEY)?.projectId;
        setProject((p) => (belongsTo && belongsTo !== p.id ? p : {
          ...p,
          audioUrl: data.audioUrl,
          cues: data.cues,
          audioSeconds: data.audioSeconds,
          // The old character alignment belongs to whoever spoke last. Keeping
          // it beside fresh cues would leave two disagreeing sources of truth,
          // and the timing code prefers cues — so the stale one would sit
          // there being wrong and invisible.
          alignment: undefined,
          voice: {
            provider: "elevenlabs",
            name: data.voice,
            label: data.voiceLabel,
            model: data.model,
            language: data.language,
          },
        }));
        setVoiceNote(
          [
            `${(data.characters ?? 0).toLocaleString("de-DE")} Zeichen gesprochen`,
            `${(data.audioSeconds ?? 0).toFixed(0)} s`,
            data.modelLabel,
            data.voiceLabel,
          ]
            .filter(Boolean)
            .join(" · "),
        );
      } else {
        setVoiceError(result.data.error ?? "Die Sprachausgabe ist fehlgeschlagen.");
      }
      rememberJob(VOICE_KEY, null);
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

  /**
   * Hand over a subtitle file.
   *
   * Built in the browser from data the project already holds — the cut this
   * format wrote itself plus the written sentences — so it costs nothing and
   * needs no round trip. Same-origin, so the download attribute is enough
   * here, unlike the videos which live on the blob domain.
   */
  function downloadSubtitles() {
    const blob = new Blob([toSrt(project)], {
      type: "application/x-subrip;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = subtitleFilename(project);
    a.click();
    // Revoked on the next tick rather than immediately: revoking before the
    // click has been handled cancels the download in some browsers.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ---- Render -------------------------------------------------------------
  async function startRender(short?: Story["shorts"][number]) {
    const result = await postJson<{ renderId: string }>("/api/render", {
      project,
      // Filed against the project so the finished file is findable later,
      // whether or not this tab is still open when it lands.
      projectId: projectId ?? undefined,
      short,
    });
    if (!result.ok) {
      if (short) setShortsError(result.error);
      else setError(result.error);
      return;
    }
    setRender({
      renderId: result.data.renderId,
      status: "queued",
      progress: 0,
      shortId: short?.id,
    });
  }

  /**
   * Den Pflichthinweis nachrüsten.
   *
   * Nur für Videos, die vor dieser Regel geschrieben wurden — neue bekommen
   * ihn in der Pipeline. Die Aufnahme wird dabei verworfen: es kommen zwei
   * Sätze dazu, und eine Tonspur, die zu einem anderen Skript gehört, wäre
   * schlimmer als gar keine.
   */
  function insertDisclaimer() {
    setProject((current) => {
      const next = withDisclaimer({
        scenes: current.scenes,
        shots: current.shots,
      });
      if (!next.inserted) return current;
      return {
        ...current,
        scenes: next.scenes,
        shots: next.shots,
        cues: undefined,
        audioUrl: undefined,
        audioSeconds: undefined,
        alignment: undefined,
        shorts: [],
      };
    });
  }

  // ---- YouTube ------------------------------------------------------------
  async function writeListing() {
    setYoutubeBusy(true);
    setYoutubeError(null);
    setYoutubeNote(null);
    const result = await postJson<{ listing: unknown; cents?: number }>(
      "/api/story/youtube",
      { project, model: youtubeModelId },
    );
    setYoutubeBusy(false);
    if (!result.ok) {
      setYoutubeError(result.error);
      return;
    }
    const parsed = YoutubeListing.safeParse(result.data.listing);
    if (!parsed.success) {
      setYoutubeError("Die Antwort ließ sich nicht lesen.");
      return;
    }
    setProject((current) => ({ ...current, youtube: parsed.data }));
    setYoutubeNote(
      result.data.cents !== undefined
        ? `Geschrieben für ${result.data.cents.toFixed(2).replace(".", ",")} US-Cent.`
        : null,
    );
  }

  /**
   * In die Zwischenablage, mit sichtbarer Bestätigung.
   *
   * Der ganze Sinn dieses Blocks ist, dass jemand ihn ins YouTube-Formular
   * einfügt. Ein Klick, der nichts sichtbar tut, wird zweimal gedrückt und
   * einmal für kaputt gehalten.
   */
  async function copy(what: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      window.setTimeout(() => setCopied((c) => (c === what ? null : c)), 1600);
    } catch {
      setYoutubeError("Die Zwischenablage ist in diesem Browser gesperrt.");
    }
  }

  // ---- Shorts -------------------------------------------------------------
  async function makeShorts() {
    setShortsBusy(true);
    setShortsError(null);
    setShortsNote(null);
    const result = await postJson<{ jobId: string }>("/api/story/shorts", {
      project,
      model: textModelId,
      voice: voiceId || undefined,
      speechModel: speechModelId,
    });
    if (!result.ok) {
      setShortsError(result.error);
      setShortsBusy(false);
      return;
    }
    rememberJob(SHORTS_KEY, result.data.jobId, project.id);
    setShortsJobId(result.data.jobId);
  }

  useEffect(() => {
    if (!shortsJobId) return;
    let cancelled = false;
    let failures = 0;
    const tick = async () => {
      const result = await getJson<{
        status: string;
        step?: string;
        project?: unknown;
        hooks?: number;
        characters?: number;
        warning?: string;
        error?: string;
      }>(`/api/story/shorts?jobId=${encodeURIComponent(shortsJobId)}`);
      if (cancelled) return;
      if (!result.ok) {
        failures += 1;
        if (failures > TOLERATED_POLL_FAILURES) {
          rememberJob(SHORTS_KEY, null);
          setShortsError(result.error);
          setShortsJobId(null);
          setShortsBusy(false);
        }
        return;
      }
      failures = 0;
      setShortsStep(result.data.step ?? null);
      if (result.data.status === "running") return;

      if (result.data.status === "done" && result.data.project) {
        const parsed = StoryProject.safeParse(result.data.project);
        if (parsed.success) {
          setProject((current) =>
            parsed.data.id === current.id ? parsed.data : current,
          );
          setShortsNote(
            `${parsed.data.shorts.length} Shorts geschnitten · ${result.data.hooks ?? 0} Hooks gesprochen (${(result.data.characters ?? 0).toLocaleString("de-DE")} Zeichen).`,
          );
        }
        if (result.data.warning) setShortsError(result.data.warning);
      } else {
        setShortsError(result.data.error ?? "Die Shorts konnten nicht geschnitten werden.");
      }
      rememberJob(SHORTS_KEY, null);
      setShortsJobId(null);
      setShortsStep(null);
      setShortsBusy(false);
    };
    void tick();
    const id = window.setInterval(() => void tick(), 2500);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [shortsJobId]);

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
        <Panel
          step="00"
          title="Projekt"
          right={
            <span
              className="mono"
              style={{
                fontSize: 11,
                color: saveState === "failed" ? "var(--alert)" : "#5b6672",
              }}
            >
              {saveState === "failed"
                ? "NICHT gespeichert"
                : saveState === "saving"
                  ? "speichert…"
                  : saveState === "saved"
                    ? "gespeichert"
                    : projectId
                      ? "geladen"
                      : "ungespeichert"}
            </span>
          }
        >
          <select
            value={projectId ?? ""}
            onChange={(e) => {
              const id = e.target.value;
              if (id) {
                void loadProject(id);
                return;
              }
              // Starting fresh forgets the id first, so the autosave below
              // mints a new project instead of overwriting the open one with
              // an empty seed.
              lastSaved.current = null;
              setProjectId(null);
              setSaveState("idle");
              try {
                window.localStorage.removeItem(PROJECT_KEY);
              } catch {
                // Nothing depends on this succeeding.
              }
              setProject(seed);
              setTopic("");
              setRender(null);
            }}
            aria-label="Gespeichertes Video"
            style={{
              width: "100%",
              padding: "10px 12px",
              border: "1px solid var(--grid)",
              background: "#fff",
              fontSize: 13,
            }}
          >
            <option value="">{finance ? "— Neues Finanzvideo —" : "— Neues Video —"}</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title} · {p.detail} · {ago(p.updatedAt)}
              </option>
            ))}
          </select>
          {saveState === "failed" ? (
            <Note tone="alert">
              Das Projekt konnte nicht gespeichert werden — es liegt nur noch
              in diesem Tab. Schließ ihn nicht, bevor hier „gespeichert“ steht.
              {saveError ? ` (${saveError})` : ""} Es wird von selbst noch
              einmal versucht.
            </Note>
          ) : null}
          {projects.length === 0 ? (
            <Note tone="info">
              Noch kein gespeichertes {finance ? "Finanzvideo" : "Video"}. Sobald
              eines erzeugt ist, landet es hier automatisch.
            </Note>
          ) : null}
        </Panel>

        <Panel step="01" title="Thema">
          <textarea
            value={topic}
            placeholder={
              finance
                ? "z. B. Miete oder Kauf — was die Rechnung wirklich sagt. Gern mit Details: welcher Kaufpreis, welche Region, welcher Zeitraum."
                : "z. B. Die Ägypter und wie sie die Hitze überlebt haben — gern mit Details: welche Bauweisen, welche Epoche, was betont werden soll."
            }
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

          {/*
            Bildrate, Bildmodell, Bildstil und Figuren gibt es nur beim
            Video-Format — beim Finanz-Format wird nichts gezeichnet, also
            gibt es auch nichts zu budgetieren. Was übrig bleibt, ist Thema,
            Länge, Modell und die Recherche.
          */}
          {finance ? null : (
            <>
          {/*
            A rate, not a count. The two together decide how often a viewer
            sees the same drawing, and that is the number worth showing — a
            budget of sixty across twenty-five minutes sounds generous and
            means every picture comes back ten times, which nobody works out
            from two sliders on their own.
          */}
          {/*
            The number that actually decides whether a film looks repetitive.
            The rate on its own says nothing: at four pictures a minute against
            roughly twenty shots a minute, every picture has to carry five
            shots, and a viewer reads the fourth return of the same drawing as
            "they ran out". Shown as appearances rather than as seconds,
            because that is what the eye counts.
          */}
          <label className="mono" style={{ fontSize: 11, color: appearances > 3 ? "var(--alert)" : "#5b6672", display: "block", margin: "12px 0 6px" }}>
            {imagesPerMinute.toFixed(1).replace(".", ",")} Bilder pro Minute ={" "}
            {imageBudget} Bilder · {formatCents(imageBudget * imageModel.cents)} ·
            rechnerisch {appearances.toFixed(1).replace(".", ",")}× je Bild zu
            sehen
          </label>
          <input
            type="range"
            min={1}
            max={12}
            step={0.5}
            value={imagesPerMinute}
            onChange={(e) => setImagesPerMinute(Number(e.target.value))}
            style={{ width: "100%" }}
            aria-label="Bilder pro Minute"
          />
          <div className="mono" style={{ fontSize: 10.5, color: "#5b6672", marginTop: 4 }}>
            Das ist die Anzahl, nicht der Takt. Wie lange ein Bild am Stück
            steht, entscheidet der Text — bleibt es stehen, läuft die
            Kamerafahrt weiter, ohne Schnitt. Das zählt als EIN Auftritt.
          </div>
          {appearances > 3 ? (
            <Note tone="alert">
              Bei dieser Rate muss jedes Bild {appearances.toFixed(1).replace(".", ",")}
              × auftauchen. Ab dem vierten Mal wirkt es, als wären die Bilder
              ausgegangen. Für höchstens drei Auftritte bräuchtest du{" "}
              {Math.ceil(SHOTS_PER_MINUTE / 3)} Bilder pro Minute — das kostet{" "}
              {formatCents(Math.ceil(SHOTS_PER_MINUTE / 3) * minutes * imageModel.cents)}.
            </Note>
          ) : null}

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

          {/*
            The look, before there is one. Two mutually exclusive ways to
            decide it: reuse a kept one, or say what it should be. Exclusive on
            purpose — a wish next to a saved look would be an instruction to
            change something that was saved precisely so it would not change.
          */}
          <div className="mono" style={{ fontSize: 11, color: "#5b6672", margin: "16px 0 6px" }}>
            BILDSTIL
          </div>
          <select
            value={lookId}
            onChange={(e) => setLookId(e.target.value)}
            aria-label="Gespeicherter Bildstil"
            style={{
              width: "100%",
              padding: "9px 10px",
              border: "1px solid var(--grid)",
              background: "#fff",
              fontSize: 13,
            }}
          >
            <option value="">— Stil neu festlegen lassen —</option>
            {looks.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
                {l.uses > 0 ? ` · ${l.uses}× benutzt` : ""}
              </option>
            ))}
          </select>

          {lookId ? (
            <Note tone="info">
              Der gespeicherte Stil wird unverändert übernommen. Das ist der
              Punkt: Videos mit demselben Stil teilen sich die Bild-Bibliothek,
              ein neu erfundener Stil teilt sich nichts.
            </Note>
          ) : (
            <textarea
              value={styleWish}
              placeholder="Stilwunsch, optional: „wärmere Erdtöne, keine Strichmännchen, mehr Papierschnitt“"
              onChange={(e) => setStyleWish(e.target.value)}
              aria-label="Stilwunsch"
              rows={2}
              style={{
                width: "100%",
                padding: "9px 10px",
                border: "1px solid var(--grid)",
                background: "#fff",
                fontSize: 13,
                lineHeight: 1.4,
                resize: "vertical",
                marginTop: 8,
              }}
            />
          )}

          {/*
            The cast. Optional, and empty by default, because the format's
            normal answer for people — anonymous stick figures — is the right
            one for an explainer. A figure is for a series that wants a face.
          */}
          <div className="mono" style={{ fontSize: 11, color: "#5b6672", margin: "16px 0 6px" }}>
            FIGUREN ({cast.length})
          </div>

          {cast.map((c, i) => (
            <div
              key={i}
              style={{
                border: "1px solid var(--grid)",
                padding: 8,
                marginBottom: 6,
                background: "#fff",
              }}
            >
              <div style={{ display: "flex", gap: 6 }}>
                <input
                  value={c.name}
                  placeholder="Name, z. B. Der Forscher"
                  onChange={(e) =>
                    setCast((list) =>
                      list.map((x, j) =>
                        j === i ? { ...x, name: e.target.value } : x,
                      ),
                    )
                  }
                  aria-label="Name der Figur"
                  style={{
                    flex: 1,
                    padding: "6px 8px",
                    border: "1px solid var(--grid)",
                    fontSize: 13,
                  }}
                />
                <Button
                  variant="ghost"
                  onClick={() => void keepCharacter(c)}
                  disabled={c.name.trim().length < 2 || c.description.trim().length < 3}
                >
                  merken
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => setCast((list) => list.filter((_, j) => j !== i))}
                >
                  ✕
                </Button>
              </div>
              <textarea
                value={c.description}
                placeholder="Wie sie aussieht: „schmale Gestalt im roten Anorak, Klemmbrett unter dem Arm, keine Gesichtszüge“"
                onChange={(e) =>
                  setCast((list) =>
                    list.map((x, j) =>
                      j === i ? { ...x, description: e.target.value } : x,
                    ),
                  )
                }
                aria-label="Beschreibung der Figur"
                rows={2}
                style={{
                  width: "100%",
                  marginTop: 6,
                  padding: "6px 8px",
                  border: "1px solid var(--grid)",
                  fontSize: 12.5,
                  lineHeight: 1.4,
                  resize: "vertical",
                }}
              />
            </div>
          ))}

          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <Button
              variant="ghost"
              onClick={() =>
                setCast((list) =>
                  list.length >= 6
                    ? list
                    : [...list, { key: "", name: "", description: "" }],
                )
              }
              disabled={cast.length >= 6}
            >
              + Figur
            </Button>
            {saved.length > 0 ? (
              <select
                value=""
                onChange={(e) => {
                  const found = saved.find((c) => c.key === e.target.value);
                  if (!found) return;
                  setCast((list) =>
                    list.some((c) => c.key === found.key) || list.length >= 6
                      ? list
                      : [
                          ...list,
                          {
                            key: found.key,
                            name: found.name,
                            description: found.description,
                          },
                        ],
                  );
                }}
                aria-label="Gespeicherte Figur übernehmen"
                style={{
                  flex: 1,
                  minWidth: 160,
                  padding: "8px 10px",
                  border: "1px solid var(--grid)",
                  background: "#fff",
                  fontSize: 12.5,
                }}
              >
                <option value="">— gemerkte Figur übernehmen —</option>
                {saved.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.name}
                    {c.uses > 0 ? ` · ${c.uses}×` : ""}
                  </option>
                ))}
              </select>
            ) : null}
          </div>
          {lookNote ? <Note tone="info">{lookNote}</Note> : null}
          {cast.length > 0 ? (
            <Note tone="info">
              Beschreib sie in deinen Worten. Beim Festlegen des Stils wird
              jede Figur in genau diesen Look übersetzt — dieselbe Figur sieht
              in einem anderen Video deshalb anders aus, und das ist gewollt.
            </Note>
          ) : null}
            </>
          )}


          {finance ? null : (
            <>
          <div className="mono" style={{ fontSize: 11, color: "#5b6672", margin: "16px 0 6px" }}>
            WIE ERZÄHLT WIRD
          </div>
          <div style={{ display: "grid", gap: 6 }}>
            {(
              [
                {
                  id: "erklaerung" as const,
                  title: "Erklärstück",
                  note: "Erklärt eine Sache und sagt dem Zuschauer im ersten Satz, was sie mit ihm zu tun hat. Nennt, wer verdient und wer zahlt.",
                },
                {
                  id: "erlebnis" as const,
                  title: "Du bist dabei",
                  note: "Der Zuschauer ist die Person, um die es geht. Braucht ein Thema mit Menschen — eine Reise, ein Beruf, ein Tag in einer anderen Zeit.",
                },
              ]
            ).map((p) => (
              <label
                key={p.id}
                style={{
                  display: "flex",
                  gap: 8,
                  alignItems: "flex-start",
                  padding: "8px 10px",
                  border: "1px solid var(--grid)",
                  background: perspective === p.id ? "#f4f7fb" : "#fff",
                  fontSize: 12.5,
                  lineHeight: 1.4,
                  cursor: "pointer",
                }}
              >
                <input
                  type="radio"
                  name="perspective"
                  checked={perspective === p.id}
                  onChange={() => setPerspective(p.id)}
                  style={{ marginTop: 2 }}
                />
                <span>
                  {p.title}
                  <span
                    className="mono"
                    style={{ display: "block", fontSize: 10.5, color: "#5b6672" }}
                  >
                    {p.note}
                  </span>
                </span>
              </label>
            ))}
          </div>
            </>
          )}

          <div className="mono" style={{ fontSize: 11, color: "#5b6672", margin: "16px 0 6px" }}>
            WER SCHREIBT
          </div>
          <select
            value={textModelId}
            onChange={(e) => setTextModelId(e.target.value)}
            aria-label="Schreibmodell"
            style={{
              width: "100%",
              padding: "9px 10px",
              border: "1px solid var(--grid)",
              background: "#fff",
              fontSize: 13,
            }}
          >
            {TEXT_MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label} — {m.provider === "anthropic" ? "Anthropic" : "Google"}
                {" · "}
                {m.outputPerM.toFixed(2).replace(".", ",")} $ je Mio. Wörter-Token
              </option>
            ))}
          </select>
          <div className="mono" style={{ fontSize: 10.5, color: "#5b6672", marginTop: 4 }}>
            {TEXT_MODELS.find((m) => m.id === textModelId)?.note}
          </div>

          <label
            style={{
              display: "flex",
              gap: 8,
              alignItems: "flex-start",
              marginTop: 10,
              fontSize: 12.5,
              lineHeight: 1.4,
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={research}
              onChange={(e) => setResearch(e.target.checked)}
              style={{ marginTop: 2 }}
            />
            <span>
              Fakten vorher im Web recherchieren
              <span
                className="mono"
                style={{ display: "block", fontSize: 10.5, color: "#5b6672" }}
              >
                {research
                  ? "Zahlen, Daten und Namen kommen dann nur aus geprüften Quellen. Dauert bis zu 80 Sekunden länger."
                  : "Ohne Recherche schreibt das Modell aus dem Gedächtnis — flüssig, aber bei Daten und Namen oft daneben."}
              </span>
            </span>
          </label>

          <div style={{ height: 10 }} />
          <Button onClick={() => void generate()} disabled={busy || topic.trim().length < 3}>
            {busy ? (step ?? "Wird geschrieben…") : "Skript schreiben"}
          </Button>
          {error ? <Note tone="alert">{error}</Note> : null}
          {warning ? <Note tone="alert">{warning}</Note> : null}
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
              — läuft auf dem Server.{finance ? "" : " Es wird noch nichts gezeichnet."}
            </Note>
          ) : null}
          <Note tone="info">
            {finance
              ? "Es wird nichts gezeichnet. Die Grafiken entstehen beim Rendern aus den Zahlen im Skript — ein Finanzvideo kostet nur das Skript und die Stimme."
              : `Erst schreiben, dann zeichnen. Ein Skript kostet Bruchteile eines Cents und lässt sich wegwerfen; ${imageBudget} Bilder kosten ${formatCents(
                  imageBudget * imageModel.cents,
                )}.`}
          </Note>
        </Panel>

        {project.shots.length > 0 && project.id !== seed.id ? (
          <>
            {/*
              The look, after there is one — and editable, which is the whole
              addition. The directive is pasted verbatim into every image
              prompt, so this textarea is not a description of the style; it IS
              the style. Nothing redraws by itself: an edit costs nothing until
              the pictures are discarded below.
            */}
            {project.research ? (
              <Panel
                step="02"
                title="Fakten"
                right={
                  <span className="mono" style={{ fontSize: 11, color: "#5b6672" }}>
                    {project.research.split("\n").filter(Boolean).length} belegt
                  </span>
                }
              >
                {/*
                  Shown, not hidden behind a debug flag: these are the only
                  claims in the video that anybody can check, and the person
                  publishing it is the one who has to stand behind them.
                */}
                <div
                  style={{
                    maxHeight: 220,
                    overflowY: "auto",
                    fontSize: 12,
                    lineHeight: 1.5,
                    whiteSpace: "pre-wrap",
                    border: "1px solid var(--grid)",
                    background: "#fff",
                    padding: "8px 10px",
                  }}
                >
                  {project.research}
                </div>
                <Note tone="info">
                  Aus diesen Quellen stammt jede Zahl im Skript. Was hier nicht
                  steht, durfte das Modell nicht behaupten.
                </Note>
              </Panel>
            ) : null}

            {/*
              Stil und Bilder gibt es nur beim Video-Format. Beim Finanz-Format
              wird nichts gezeichnet — die Grafiken entstehen beim Rendern aus
              den Zahlen, und ein Bildstil hätte nichts, worauf er wirken
              könnte.
            */}
            {finance ? null : (
            <Panel
              step={panelStep(2)}
              title="Stil"
              right={
                <span className="mono" style={{ fontSize: 11, color: "#5b6672" }}>
                  {drawnCount > 0 ? `${drawnCount} gezeichnet` : "nichts gezeichnet"}
                </span>
              }
            >
              <input
                value={project.style.name}
                onChange={(e) =>
                  setProject((p) => ({
                    ...p,
                    style: { ...p.style, name: e.target.value.slice(0, 80) },
                  }))
                }
                aria-label="Name des Stils"
                style={{
                  width: "100%",
                  padding: "8px 10px",
                  border: "1px solid var(--grid)",
                  fontSize: 13,
                  fontWeight: 600,
                }}
              />

              <div style={{ display: "flex", gap: 6, margin: "10px 0", flexWrap: "wrap" }}>
                {project.style.palette.map((c, i) => (
                  <input
                    key={i}
                    type="color"
                    value={c}
                    title={c}
                    onChange={(e) =>
                      setProject((p) => ({
                        ...p,
                        style: {
                          ...p.style,
                          palette: p.style.palette.map((old, j) =>
                            j === i ? e.target.value : old,
                          ),
                        },
                      }))
                    }
                    aria-label={`Farbe ${i + 1}`}
                    style={{
                      width: 34,
                      height: 30,
                      padding: 0,
                      border: "1px solid var(--grid)",
                      background: "#fff",
                      cursor: "pointer",
                    }}
                  />
                ))}
                <span className="mono" style={{ fontSize: 10.5, color: "#5b6672", alignSelf: "center" }}>
                  wird als verbindliche Palette an jedes Bild gehängt
                </span>
              </div>

              <textarea
                value={project.style.directive}
                onChange={(e) =>
                  setProject((p) => ({
                    ...p,
                    style: { ...p.style, directive: e.target.value.slice(0, 1200) },
                  }))
                }
                aria-label="Stiltext"
                rows={7}
                style={{
                  width: "100%",
                  padding: "9px 10px",
                  border: "1px solid var(--grid)",
                  background: "#fff",
                  fontSize: 12,
                  lineHeight: 1.45,
                  fontFamily: "var(--mono, ui-monospace), monospace",
                  resize: "vertical",
                }}
              />

              {(project.characters ?? []).length > 0 ? (
                <div style={{ marginTop: 10 }}>
                  {(project.characters ?? []).map((c: StoryCharacter) => (
                    <details
                      key={c.key}
                      style={{
                        borderBottom: "1px solid var(--grid)",
                        padding: "5px 0",
                        fontSize: 12,
                      }}
                    >
                      <summary style={{ cursor: "pointer" }}>
                        {c.name}
                        <span className="mono" style={{ fontSize: 10, color: "#5b6672" }}>
                          {" "}
                          · {project.images.filter((i) => i.characters?.includes(c.key)).length} Bilder
                        </span>
                      </summary>
                      <p style={{ margin: "6px 0 0", color: "#5b6672", lineHeight: 1.45 }}>
                        {c.appearance ?? c.description}
                      </p>
                    </details>
                  ))}
                </div>
              ) : null}

              <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
                <Button variant="ghost" onClick={() => void keepLook()}>
                  Stil merken
                </Button>
                <Button
                  variant="ghost"
                  onClick={discardImages}
                  disabled={drawnCount === 0}
                >
                  Bilder verwerfen
                </Button>
              </div>
              {lookNote ? <Note tone="info">{lookNote}</Note> : null}
              <Note tone="info">
                Änderungen wirken nur auf Bilder, die noch nicht gezeichnet
                sind. Damit ein geänderter Stil sichtbar wird, musst du die
                vorhandenen verwerfen — das kostet erneut.
              </Note>
            </Panel>
            )}

            {finance ? null : (
            <Panel
              step={panelStep(3)}
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
                      // The small copy, not the drawing. Seventy-five rows
                      // pointing at full-size PNGs was about a hundred
                      // megabytes of blob traffic every time this project was
                      // opened — for pictures shown 48 pixels wide. Older
                      // entries have no thumbnail and still fall back.
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={img.thumbUrl ?? img.url}
                        alt=""
                        loading="lazy"
                        decoding="async"
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
            )}

            <Panel
              step={panelStep(4)}
              title="Klang"
              right={
                <span className="mono" style={{ fontSize: 11, color: "#5b6672" }}>
                  {(project.sounds ?? []).filter((s) => s.url).length}/
                  {(project.sounds ?? []).length}
                </span>
              }
            >
              {(project.sounds ?? []).length === 0 ? (
                <Note tone="info">
                  {finance
                    ? "Dieses Video hat noch keine Musik. Erzeug das Skript neu, dann plant es einen ruhigen Teppich mit."
                    : "Dieses Video hat noch kein Klangdesign. Skripte, die vor dieser Erweiterung geschrieben wurden, kennen es nicht — erzeug das Skript neu, dann plant es Klangteppiche und Akzente mit."}
                </Note>
              ) : (
                <>
                  <Button
                    onClick={() => void makeSounds()}
                    disabled={sfxBusy || soundCost(project).sounds === 0}
                  >
                    {sfxBusy
                      ? (sfxStep ?? "wird erzeugt…")
                      : soundCost(project).sounds === 0
                        ? finance
                          ? "Musik ist da"
                          : "Alle Geräusche erzeugt"
                        : `${soundCost(project).sounds} ${
                            finance ? "erzeugen" : "Geräusche erzeugen"
                          } — ${soundCost(project).characters.toLocaleString("de-DE")} Zeichen`}
                  </Button>
                  {sfxError ? <Note tone="alert">{sfxError}</Note> : null}
                  {sfxNote ? <Note tone="info">{sfxNote}</Note> : null}
                  {finance ? (
                    <Note tone="info">
                      Beim Finanz-Format ist der Teppich Musik statt Umgebung:
                      weiche Flächen, tiefer Puls, keine Melodie. Er läuft leise
                      unter dem ganzen Video durch. Einzelne Geräusche kommen
                      nur dazu, wenn der Text sie selbst nennt.
                    </Note>
                  ) : null}

                  <label
                    className="mono"
                    style={{ fontSize: 11, color: "#5b6672", display: "block", margin: "10px 0 4px" }}
                  >
                    Lautstärke unter der Stimme:{" "}
                    {Math.round(project.soundLevel * 100)} %
                  </label>
                  <input
                    type="range"
                    min={0}
                    max={0.6}
                    step={0.02}
                    value={project.soundLevel}
                    onChange={(e) =>
                      setProject((p) => ({
                        ...p,
                        soundLevel: Number(e.target.value),
                      }))
                    }
                    style={{ width: "100%" }}
                    aria-label="Klanglautstärke"
                  />

                  <div style={{ marginTop: 10, maxHeight: 200, overflowY: "auto" }}>
                    {(project.sounds ?? []).map((snd) => (
                      <div
                        key={snd.key}
                        style={{
                          display: "flex",
                          gap: 8,
                          alignItems: "center",
                          padding: "5px 0",
                          borderBottom: "1px solid var(--grid)",
                          fontSize: 12,
                        }}
                      >
                        <span
                          className="mono"
                          style={{ fontSize: 10, color: "#5b6672", minWidth: 62 }}
                        >
                          {snd.kind === "ambience" ? "Teppich" : "Akzent"}
                        </span>
                        <span style={{ flex: 1 }}>{snd.name}</span>
                        {snd.reused ? (
                          <span
                            className="mono"
                            style={{ fontSize: 10, color: "#5b6672" }}
                            title="kam aus der Bibliothek, kostete nichts"
                          >
                            Bibliothek
                          </span>
                        ) : null}
                        {snd.url ? (
                          <audio src={snd.url} controls style={{ height: 24, width: 130 }} />
                        ) : (
                          <span className="mono" style={{ fontSize: 10, color: "#5b6672" }}>
                            {snd.seconds}s
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </Panel>

            <Panel
              step={panelStep(5)}
              title="Stimme"
              right={
                <span className="mono" style={{ fontSize: 11, color: "#5b6672" }}>
                  {project.audioUrl ? `${timing.audioSeconds.toFixed(0)} s` : "fehlt"}
                </span>
              }
            >
              {/*
                Which model, which voice, which language — in that order,
                because the model decides what the other two mean. Flash bills
                at half of Multilingual v2 and takes four times as much text in
                one request; Multilingual v2 is the more expressive read and
                cannot be told a language at all. That last asymmetry is why
                the picker has to explain itself rather than just sit there.
              */}
              <select
                value={speechModelId}
                onChange={(e) => setSpeechModelId(e.target.value)}
                aria-label="Sprachmodell"
                style={{
                  width: "100%",
                  padding: "9px 10px",
                  border: "1px solid var(--grid)",
                  background: "#fff",
                  fontSize: 13,
                  marginBottom: 8,
                }}
              >
                {SPEECH_MODELS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label} — {m.credits === 1 ? "voller Preis" : `${m.credits}× Preis`}
                  </option>
                ))}
              </select>

              {voices.length > 0 ? (
                <select
                  value={voiceId}
                  onChange={(e) => setVoiceId(e.target.value)}
                  aria-label="Stimme"
                  style={{
                    width: "100%",
                    padding: "9px 10px",
                    border: "1px solid var(--grid)",
                    background: "#fff",
                    fontSize: 13,
                    marginBottom: 8,
                  }}
                >
                  <option value="">— Stimme aus der Konfiguration —</option>
                  {voices.map((v) => (
                    <option key={v.voiceId} value={v.voiceId}>
                      {v.name}
                      {v.labels?.gender ? ` · ${v.labels.gender}` : ""}
                      {v.labels?.accent ? ` · ${v.labels.accent}` : ""}
                    </option>
                  ))}
                </select>
              ) : null}

              {speechModel.language && languages.length > 0 ? (
                <select
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  aria-label="Sprache"
                  style={{
                    width: "100%",
                    padding: "9px 10px",
                    border: "1px solid var(--grid)",
                    background: "#fff",
                    fontSize: 13,
                    marginBottom: 8,
                  }}
                >
                  {languages.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              ) : null}

              <Button onClick={() => void speak()} disabled={voiceBusy}>
                {voiceBusy
                  ? "wird gesprochen…"
                  : project.audioUrl
                    ? "Neu sprechen"
                    : "Sprechen"}
              </Button>

              {/*
                Three separate things can be true at once, so they are three
                separate notes rather than one paragraph that tries to cover
                all of them and covers none.
              */}
              {!speechModel.language ? (
                <Note tone="info">
                  {speechModel.label} nimmt keine Sprachangabe entgegen — es
                  erkennt die Sprache am Text. Für Deutsch ist das in Ordnung;
                  eine Sprachauswahl gibt es nur bei{" "}
                  {SPEECH_MODELS.filter((m) => m.language)
                    .map((m) => m.label)
                    .join(", ")}
                  .
                </Note>
              ) : null}

              {chosenVoice &&
              chosenVoice.models?.length &&
              !chosenVoice.models.includes(speechModelId) ? (
                <Note tone="alert">
                  „{chosenVoice.name}“ ist für {speechModel.label} nicht als
                  hochwertig ausgewiesen. Sie spricht trotzdem, klingt aber
                  womöglich schlechter als auf{" "}
                  {chosenVoice.models
                    .map((id) => resolveSpeechModel(id).label)
                    .join(", ")}
                  .
                </Note>
              ) : null}

              {speechModel.language &&
              chosenVoice?.languages?.length &&
              !chosenVoice.languages.includes(language) ? (
                <Note tone="alert">
                  „{chosenVoice.name}“ ist nur für{" "}
                  {chosenVoice.languages.join(", ")} geprüft — für die gewählte
                  Sprache also nicht. Erwarte einen Akzent.
                </Note>
              ) : null}
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
                {Math.round(estimatedChars * speechModel.credits).toLocaleString("de-DE")}{" "}
                Zeichen vom Kontingent
                {speechModel.credits === 1
                  ? ""
                  : ` (${estimatedChars.toLocaleString("de-DE")} × ${speechModel.credits.toLocaleString("de-DE")})`}
                {" · "}
                {Math.max(1, Math.ceil(estimatedChars / speechModel.maxChars))}{" "}
                {Math.ceil(estimatedChars / speechModel.maxChars) === 1
                  ? "Aufnahme"
                  : "Aufnahmen"}
                .
              </Note>

              {/*
                Only once the voice exists. Before that the cut is estimated
                from word counts, and subtitles built on a guess would drift
                away from the audio they are supposed to accompany — silently,
                which is the worst way for a subtitle file to be wrong.
              */}
              {project.cues?.length === project.shots.length ? (
                <>
                  <div style={{ height: 10 }} />
                  <Button variant="download" onClick={downloadSubtitles}>
                    ↓ Untertitel für YouTube ({subtitleCues(project).length} Zeilen)
                  </Button>
                  <div
                    className="mono"
                    style={{ fontSize: 11, color: "#5b6672", marginTop: 6 }}
                  >
                    SubRip (.srt), deutsch, Zeiten aus der Aufnahme. Bei YouTube
                    unter Untertitel → Datei hochladen.
                  </div>
                </>
              ) : null}
            </Panel>

            <Panel step={panelStep(6)} title="Rendern">
              {/*
                Der Hinweis ist beim Finanz-Format Bedingung, nicht Empfehlung
                — der Render verweigert ohne ihn. Neue Videos bekommen ihn beim
                Schreiben; das hier ist für die, die vorher entstanden sind.
              */}
              {finance && !hasDisclaimer(project) ? (
                <>
                  <Note tone="alert">
                    Diesem Video fehlt der Hinweis, dass es keine
                    Anlageberatung ist. Ohne ihn wird nicht gerendert.
                  </Note>
                  <Button onClick={insertDisclaimer}>
                    Hinweis einsetzen
                  </Button>
                  <Note tone="info">
                    Er kommt nach dem Einstieg, wird gesprochen und steht im
                    Bild. Weil zwei Sätze dazukommen, muss die Stimme danach
                    neu aufgenommen werden.
                  </Note>
                </>
              ) : null}
              <Button
                onClick={() => void startRender()}
                disabled={Boolean(render && render.status !== "done" && render.status !== "error")}
              >
                {render && render.status !== "done" && render.status !== "error"
                  ? `${Math.round((render.progress ?? 0) * 100)} % — ${render.phase ?? "läuft"}`
                  : "Video rendern"}
              </Button>
              {render?.error ? <Note tone="alert">{render.error}</Note> : null}
              {finishedVideo ? (
                <DownloadButton
                  url={finishedVideo.url}
                  sizeBytes={finishedVideo.sizeBytes}
                />
              ) : null}
              <RenderList renders={renders} activeRenderId={render?.renderId} />
            </Panel>

            {/*
              Offered only once the film has actually been rendered. Nothing
              technical requires it - a short is cut from the project, not from
              the MP4 - but a film nobody has watched through is not one
              anybody should be cutting highlights from.
            */}
            <Panel
              step={panelStep(7)}
              title="Shorts"
              right={
                <span className="mono" style={{ fontSize: 11, color: "#5b6672" }}>
                  {project.shorts.length > 0
                    ? `${project.shorts.length} · 9:16`
                    : finishedVideo
                      ? "keine"
                      : "erst rendern"}
                </span>
              }
            >
              <Button
                onClick={() => void makeShorts()}
                disabled={shortsBusy || !finishedVideo}
              >
                {shortsBusy
                  ? (shortsStep ?? "wird geschnitten…")
                  : project.shorts.length > 0
                    ? "Neu schneiden"
                    : `${SHORTS_PER_FILM} Shorts schneiden`}
              </Button>
              {shortsError ? <Note tone="alert">{shortsError}</Note> : null}
              {shortsNote ? <Note tone="info">{shortsNote}</Note> : null}

              {!finishedVideo ? (
                <Note tone="info">
                  Erst das Video rendern. Die Ausschnitte werden aus den
                  gemessenen Zeiten geschnitten —{" "}
                  {finance ? "Grafiken" : "Bilder"}, Stimme und Klang sind
                  schon da, es entsteht nur je ein gesprochener Hook.
                </Note>
              ) : null}

              {project.shorts.map((short) => {
                const seconds = shortSeconds(project, short.from, short.to);
                const done = renders.find(
                  (r) => r.shortId === short.id && r.outputUrl,
                );
                const running =
                  render?.shortId === short.id &&
                  render.status !== "done" &&
                  render.status !== "error";
                return (
                  <div
                    key={short.id}
                    style={{
                      borderTop: "1px solid var(--grid)",
                      padding: "10px 0 4px",
                      fontSize: 12.5,
                    }}
                  >
                    <div style={{ fontWeight: 600 }}>{short.title}</div>
                    <div
                      className="mono"
                      style={{ fontSize: 10.5, color: "#5b6672", margin: "3px 0 6px" }}
                    >
                      Einstellung {short.from + 1}–{short.to + 1} ·{" "}
                      {Math.round(seconds + (short.hookSeconds ?? 0))} s
                      {short.hookSeconds ? " · Hook gesprochen" : " · ohne Hook"}
                    </div>
                    <div style={{ color: "#5b6672", lineHeight: 1.4 }}>
                      „{short.hook}“
                    </div>
                    <div style={{ height: 8 }} />
                    <Button
                      variant="ghost"
                      onClick={() => void startRender(short)}
                      disabled={Boolean(
                        render &&
                          render.status !== "done" &&
                          render.status !== "error",
                      )}
                    >
                      {running
                        ? `${Math.round((render?.progress ?? 0) * 100)} % — ${render?.phase ?? "läuft"}`
                        : done
                          ? "Neu rendern"
                          : "Short rendern"}
                    </Button>
                    {done?.outputUrl ? (
                      <DownloadButton
                        url={done.outputUrl}
                        sizeBytes={done.sizeBytes}
                        label={`${short.title.slice(0, 28)} herunterladen`}
                      />
                    ) : null}
                  </div>
                );
              })}
            </Panel>

            {/*
              Ganz unten, weil es der letzte Handgriff ist: erst wenn der Film
              steht, weiß man, was im Upload-Formular stehen soll. Es braucht
              den Render aber nicht — wer den Text vorher will, bekommt ihn.
            */}
            <Panel
              step={panelStep(8)}
              title="YouTube"
              right={
                <span className="mono" style={{ fontSize: 11, color: "#5b6672" }}>
                  {project.youtube
                    ? `${project.youtube.chapters.length} Kapitel`
                    : "offen"}
                </span>
              }
            >
              <div className="mono" style={{ fontSize: 11, color: "#5b6672", marginBottom: 6 }}>
                WER SCHREIBT
              </div>
              <select
                value={youtubeModelId}
                onChange={(e) => setYoutubeModelId(e.target.value)}
                aria-label="Modell für den Upload-Text"
                style={{
                  width: "100%",
                  padding: "9px 10px",
                  border: "1px solid var(--grid)",
                  background: "#fff",
                  fontSize: 13,
                }}
              >
                {TEXT_MODELS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label} — {m.provider === "anthropic" ? "Anthropic" : "Google"}
                  </option>
                ))}
              </select>
              <div className="mono" style={{ fontSize: 10.5, color: "#5b6672", marginTop: 4 }}>
                Zusammenfassen ist die leichteste Aufgabe im Studio — ein
                Lite-Modell reicht dafür und kostet Bruchteile eines Cents.
              </div>

              <div style={{ height: 10 }} />
              <Button onClick={() => void writeListing()} disabled={youtubeBusy}>
                {youtubeBusy
                  ? "wird geschrieben…"
                  : project.youtube
                    ? "Neu schreiben"
                    : "Titel und Beschreibung schreiben"}
              </Button>
              {youtubeError ? <Note tone="alert">{youtubeError}</Note> : null}
              {youtubeNote ? <Note tone="info">{youtubeNote}</Note> : null}

              {!project.cues?.length ? (
                <Note tone="info">
                  Ohne gesprochene Stimme gibt es keine gemessenen Zeiten und
                  damit keine Kapitelmarken. Titel, Beschreibung und Tags
                  entstehen trotzdem.
                </Note>
              ) : null}

              {project.youtube ? (
                <>
                  <div className="mono" style={{ fontSize: 11, color: "#5b6672", margin: "16px 0 6px" }}>
                    TITEL — {project.youtube.title.length} ZEICHEN
                  </div>
                  {project.youtube.titles.map((title) => (
                    <label
                      key={title}
                      style={{
                        display: "flex",
                        gap: 8,
                        alignItems: "flex-start",
                        padding: "8px 10px",
                        marginBottom: 4,
                        border: "1px solid var(--grid)",
                        background:
                          project.youtube?.title === title ? "#f4f7fb" : "#fff",
                        fontSize: 13,
                        lineHeight: 1.4,
                        cursor: "pointer",
                      }}
                    >
                      <input
                        type="radio"
                        name="youtube-title"
                        checked={project.youtube?.title === title}
                        onChange={() =>
                          setProject((current) =>
                            current.youtube
                              ? { ...current, youtube: { ...current.youtube, title } }
                              : current,
                          )
                        }
                        style={{ marginTop: 3 }}
                      />
                      <span>
                        {title}
                        <span
                          className="mono"
                          style={{ display: "block", fontSize: 10.5, color: "#5b6672" }}
                        >
                          {title.length} Zeichen
                          {title.length > 70 ? " — YouTube schneidet in der Suche ab" : ""}
                        </span>
                      </span>
                    </label>
                  ))}
                  <Button
                    variant="ghost"
                    onClick={() => void copy("title", project.youtube!.title)}
                  >
                    {copied === "title" ? "kopiert" : "Titel kopieren"}
                  </Button>

                  <div className="mono" style={{ fontSize: 11, color: "#5b6672", margin: "16px 0 6px" }}>
                    BESCHREIBUNG
                  </div>
                  <textarea
                    value={renderDescription(project.youtube, project.kind)}
                    readOnly
                    rows={14}
                    style={{
                      width: "100%",
                      padding: "9px 10px",
                      border: "1px solid var(--grid)",
                      background: "#fff",
                      fontSize: 12.5,
                      lineHeight: 1.5,
                      resize: "vertical",
                    }}
                  />
                  <Button
                    variant="ghost"
                    onClick={() =>
                      void copy("description", renderDescription(project.youtube!, project.kind))
                    }
                  >
                    {copied === "description" ? "kopiert" : "Beschreibung kopieren"}
                  </Button>

                  {project.youtube.tags.length ? (
                    <>
                      <div className="mono" style={{ fontSize: 11, color: "#5b6672", margin: "16px 0 6px" }}>
                        TAGS — {project.youtube.tags.length}
                      </div>
                      <div style={{ fontSize: 12.5, color: "#5b6672", lineHeight: 1.5 }}>
                        {project.youtube.tags.join(", ")}
                      </div>
                      <Button
                        variant="ghost"
                        onClick={() => void copy("tags", project.youtube!.tags.join(", "))}
                      >
                        {copied === "tags" ? "kopiert" : "Tags kopieren"}
                      </Button>
                    </>
                  ) : null}
                </>
              ) : null}
            </Panel>

            <ThumbnailPanel
              step={panelStep(9)}
              // No flags in this format — it has no country questions, and an
              // unrelated flag on the cover would be a promise the video does
              // not keep.
              flags={[]}
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
          </>
        ) : null}

        {/*
          Outside the per-project block on purpose: the library is the
          studio's, not this video's. It is also the only place the sounds
          that every later film reuses can actually be heard.
        */}
        <LibraryPanel step={panelStep(10)} />
      </div>

      <div className="studio-stage">
        <div style={{ width: "100%" }}>
          <Player
            ref={playerRef}
            component={
              (finance ? FinanceVideo : StoryVideo) as React.FC<
                Record<string, unknown>
              >
            }
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
            {takes.length} Einstellungen aus {project.shots.length} Sätzen ·{" "}
            {finance
              ? `${project.scenes.length} Szenen`
              : `${project.images.length} Bilder`}{" "}
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
          project.shots.map((shot, i) => {
            // Which short, if any, this sentence ended up in. Shown in the
            // list rather than only in the panel, because the list is where
            // you read the film - and seeing that a passage is already a short
            // is exactly what tells you whether the five cover it.
            const inShort = project.shorts.findIndex(
              (sh) => i >= sh.from && i <= sh.to,
            );
            return (
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
              {/*
                Which sentences share one picture, and therefore one
                uninterrupted camera move. Without this the list reads as one
                cut per line, which is exactly what it is not.
              */}
              <span
                className="mono"
                style={{ fontSize: 10, color: "#5b6672", minWidth: 12 }}
                title={
                  i > 0 && project.shots[i - 1].image === shot.image
                    ? "bleibt auf demselben Bild — kein Schnitt"
                    : shot.image
                }
              >
                {i > 0 && project.shots[i - 1].image === shot.image ? "│" : "▸"}
              </span>
              <span style={{ flex: 1 }}>{shot.text}</span>
              {inShort >= 0 ? (
                <span
                  className="mono"
                  title={`Short ${inShort + 1}: ${project.shorts[inShort].title}`}
                  style={{
                    fontSize: 9.5,
                    fontWeight: 700,
                    color: "#fff",
                    background: "var(--download)",
                    padding: "1px 5px",
                    alignSelf: "flex-start",
                    marginTop: 2,
                  }}
                >
                  S{inShort + 1}
                </span>
              ) : null}
            </div>
            );
          })
        ) : (
          <p style={{ fontSize: 13, lineHeight: 1.5, color: "#5b6672" }}>
            Gib links ein Thema ein und lass das Skript schreiben.
          </p>
        )}
      </div>
    </div>
  );
};
