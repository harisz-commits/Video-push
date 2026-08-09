import type { Alignment, Scene, VideoProject } from "./schema";

/**
 * Scene timings are derived, never authored.
 *
 * Every scene carries an `anchorPhrase` that appears verbatim in the voiceover.
 * ElevenLabs returns a start time for every character of that same voiceover, so
 * "where does this scene begin" reduces to "where does this phrase begin" —
 * a string search. Change the script and the timing follows automatically.
 */

/** Frames of silence held after the audio ends, so the closer can breathe. */
export const TAIL_FRAMES = 45;

/** A scene may never be shorter than this, whatever the anchors say. */
const MIN_SCENE_FRAMES = 20;

/** Speaking rate used only to fake a timeline before any audio exists. */
const ESTIMATED_WORDS_PER_MINUTE = 160;

export type ResolvedScene = Scene & {
  /** Absolute start frame within the composition. */
  from: number;
  durationInFrames: number;
  startSeconds: number;
  /** False when the anchorPhrase was not found and the scene was interpolated. */
  anchorResolved: boolean;
};

export type TimingWarning = {
  sceneId: string;
  phrase: string;
  message: string;
};

export type Timing = {
  scenes: ResolvedScene[];
  totalFrames: number;
  audioDurationSeconds: number;
  warnings: TimingWarning[];
  /** True when there is no alignment yet and the timeline is a guess. */
  estimated: boolean;
};

/**
 * Collapse runs of whitespace so a phrase that differs from the voiceover only
 * in spacing or line breaks still matches, and keep a map back to the original
 * character offsets — those offsets are what index into the alignment arrays.
 */
function normalize(text: string): { norm: string; map: number[] } {
  let norm = "";
  const map: number[] = [];
  let prevWasSpace = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (/\s/.test(ch)) {
      if (prevWasSpace) continue;
      norm += " ";
      map.push(i);
      prevWasSpace = true;
    } else {
      norm += ch;
      map.push(i);
      prevWasSpace = false;
    }
  }
  return { norm, map };
}

/**
 * Find the original-text offset where `phrase` starts, searching from
 * `fromOriginalIndex` onwards so scenes stay in script order. Falls back to a
 * search from the top, then to a case-insensitive one.
 */
function findPhrase(
  haystack: { norm: string; map: number[]; lowerNorm: string },
  phrase: string,
  fromOriginalIndex: number,
): { index: number; inOrder: boolean } | null {
  const needle = normalize(phrase).norm.trim();
  if (!needle) return null;

  // Translate the original-text cursor into a normalized-text cursor.
  let normCursor = 0;
  while (
    normCursor < haystack.map.length &&
    haystack.map[normCursor] < fromOriginalIndex
  ) {
    normCursor++;
  }

  const attempts: { at: number; inOrder: boolean }[] = [
    { at: haystack.norm.indexOf(needle, normCursor), inOrder: true },
    { at: haystack.norm.indexOf(needle), inOrder: false },
    {
      at: haystack.lowerNorm.indexOf(needle.toLowerCase(), normCursor),
      inOrder: true,
    },
    { at: haystack.lowerNorm.indexOf(needle.toLowerCase()), inOrder: false },
  ];

  for (const attempt of attempts) {
    if (attempt.at !== -1) {
      return { index: haystack.map[attempt.at], inOrder: attempt.inOrder };
    }
  }
  return null;
}

/**
 * Map a character offset in the voiceover to a timestamp.
 *
 * ElevenLabs returns one entry per character of the text we sent, so normally
 * this is a direct index. If the arrays and the text ever drift apart we scale
 * proportionally rather than throwing — a slightly-off caption beats a crash.
 */
function charIndexToSeconds(
  alignment: Alignment,
  charIndex: number,
  voiceoverLength: number,
): number {
  const n = alignment.startTimesSeconds.length;
  if (n === 0) return 0;

  const direct = n === voiceoverLength;
  const i = direct
    ? charIndex
    : Math.round((charIndex / Math.max(1, voiceoverLength)) * (n - 1));

  return alignment.startTimesSeconds[Math.max(0, Math.min(n - 1, i))] ?? 0;
}

export function audioDuration(alignment: Alignment | undefined): number {
  if (!alignment || alignment.endTimesSeconds.length === 0) return 0;
  return alignment.endTimesSeconds[alignment.endTimesSeconds.length - 1] ?? 0;
}

export function resolveSceneTimings(project: VideoProject): Timing {
  const { scenes, fps, voiceover, alignment } = project;
  const warnings: TimingWarning[] = [];

  if (scenes.length === 0) {
    return {
      scenes: [],
      totalFrames: 1,
      audioDurationSeconds: 0,
      warnings,
      estimated: true,
    };
  }

  // ---- No audio yet: spread scenes evenly so the Player still previews. ----
  if (!alignment || alignment.startTimesSeconds.length === 0) {
    const words = voiceover.trim().split(/\s+/).filter(Boolean).length;
    const estimatedSeconds = Math.max(
      scenes.length * 2,
      (words / ESTIMATED_WORDS_PER_MINUTE) * 60,
    );
    const per = Math.max(
      MIN_SCENE_FRAMES,
      Math.round((estimatedSeconds * fps) / scenes.length),
    );
    const resolved = scenes.map((scene, i) => ({
      ...scene,
      from: i * per,
      durationInFrames: per,
      startSeconds: (i * per) / fps,
      anchorResolved: false,
    }));
    return {
      scenes: resolved,
      totalFrames: per * scenes.length,
      audioDurationSeconds: estimatedSeconds,
      warnings,
      estimated: true,
    };
  }

  // ---- Locate each anchor phrase in the voiceover. ----
  const normalized = normalize(voiceover);
  const haystack = {
    ...normalized,
    lowerNorm: normalized.norm.toLowerCase(),
  };

  const startFrames: (number | null)[] = new Array(scenes.length).fill(null);
  const resolvedFlags: boolean[] = new Array(scenes.length).fill(false);
  let cursor = 0;

  scenes.forEach((scene, i) => {
    const phrase = scene.anchorPhrase?.trim();
    if (!phrase) {
      warnings.push({
        sceneId: scene.id,
        phrase: "",
        message: "Keine anchorPhrase gesetzt — Szene wird gleichmäßig verteilt.",
      });
      return;
    }

    const hit = findPhrase(haystack, phrase, cursor);
    if (!hit) {
      warnings.push({
        sceneId: scene.id,
        phrase,
        message: `Phrase „${phrase}" kommt im Voiceover nicht vor — Szene wird zwischen den Nachbarn verteilt.`,
      });
      return;
    }

    if (!hit.inOrder) {
      warnings.push({
        sceneId: scene.id,
        phrase,
        message: `Phrase „${phrase}" steht im Voiceover vor der vorherigen Szene — Reihenfolge prüfen.`,
      });
    }

    const seconds = charIndexToSeconds(alignment, hit.index, voiceover.length);
    startFrames[i] = Math.round(seconds * fps);
    resolvedFlags[i] = true;
    cursor = hit.index + 1;
  });

  const audioSeconds = audioDuration(alignment);
  const endFrame = Math.round(audioSeconds * fps) + TAIL_FRAMES;

  // The video always starts at frame 0, whatever the first anchor says.
  startFrames[0] = 0;
  resolvedFlags[0] = true;

  // ---- Fill the gaps: interpolate unresolved scenes between known anchors. ----
  for (let i = 0; i < scenes.length; i++) {
    if (startFrames[i] !== null) continue;

    let prev = i - 1;
    while (prev >= 0 && startFrames[prev] === null) prev--;
    let next = i + 1;
    while (next < scenes.length && startFrames[next] === null) next++;

    const prevFrame = prev >= 0 ? (startFrames[prev] as number) : 0;
    const nextFrame =
      next < scenes.length ? (startFrames[next] as number) : endFrame;
    const gapCount = next - prev;
    const step = (nextFrame - prevFrame) / Math.max(1, gapCount);

    startFrames[i] = Math.round(prevFrame + step * (i - prev));
  }

  // ---- Enforce monotonic, minimum-length scenes. ----
  for (let i = 1; i < scenes.length; i++) {
    const previous = startFrames[i - 1] as number;
    if ((startFrames[i] as number) < previous + MIN_SCENE_FRAMES) {
      startFrames[i] = previous + MIN_SCENE_FRAMES;
    }
  }

  const lastStart = startFrames[scenes.length - 1] as number;
  const totalFrames = Math.max(lastStart + MIN_SCENE_FRAMES, endFrame);

  const resolved: ResolvedScene[] = scenes.map((scene, i) => {
    const from = startFrames[i] as number;
    const to =
      i === scenes.length - 1 ? totalFrames : (startFrames[i + 1] as number);
    return {
      ...scene,
      from,
      durationInFrames: Math.max(MIN_SCENE_FRAMES, to - from),
      startSeconds: from / fps,
      anchorResolved: resolvedFlags[i],
    };
  });

  return {
    scenes: resolved,
    totalFrames,
    audioDurationSeconds: audioSeconds,
    warnings,
    estimated: false,
  };
}

/** Word-level timings derived from the character alignment. */
export type WordTiming = { word: string; start: number; end: number };

export function wordsFromAlignment(alignment: Alignment): WordTiming[] {
  const words: WordTiming[] = [];
  let current = "";
  let start = 0;
  let end = 0;

  const flush = () => {
    if (current.trim()) words.push({ word: current, start, end });
    current = "";
  };

  for (let i = 0; i < alignment.characters.length; i++) {
    const ch = alignment.characters[i];
    if (/\s/.test(ch)) {
      flush();
      continue;
    }
    if (!current) start = alignment.startTimesSeconds[i] ?? end;
    current += ch;
    end = alignment.endTimesSeconds[i] ?? start;
  }
  flush();

  return words;
}
