import type { Alignment, Scene, VideoProject } from "./schema";
import { spellNumbers } from "./say-numbers";

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

/**
 * The text this alignment actually belongs to.
 *
 * Voiceovers recorded before numbers were spelled out have one timestamp per
 * character of the WRITTEN script; everything recorded since has one per
 * character of the spoken form. Both have to keep working, and the alignment
 * itself says which is which — its length matches the text that produced it.
 *
 * Preferring the spoken form on a tie is deliberate: the two are identical
 * whenever the script contains no number at all, and then it makes no
 * difference which one is chosen.
 */
function spokenFor(
  voiceover: string,
  alignment: Alignment,
): { text: string; converted: boolean } {
  const spoken = spellNumbers(voiceover);
  const n = alignment.startTimesSeconds.length;
  if (spoken.length === n) return { text: spoken, converted: true };
  if (voiceover.length === n) return { text: voiceover, converted: false };
  // Neither matches — the alignment drifted from both, and charIndexToSeconds
  // will scale proportionally whatever it is given. The spoken form is the
  // better guess, because it is what a current recording was made from.
  return { text: spoken, converted: true };
}

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
  //
  // In the text as it was SPOKEN, not as it is written. ElevenLabs returns one
  // timestamp per character of what it was sent, and what it is sent has its
  // numbers spelled out — "1789" leaves here as twenty-nine characters, not
  // four. Searching the written script would put every anchor after the first
  // number at the wrong offset, and the length mismatch would quietly demote
  // every timing in the video from exact to proportional.
  //
  // Both sides go through the same conversion, so an anchor still matches the
  // passage it was lifted from.
  // One decision for both sides. Converting the anchor while searching the
  // written text — or the other way round — finds nothing at all, which is
  // worse than either choice made consistently: the scene falls back to being
  // interpolated between its neighbours and the warning blames the script.
  const spoken = spokenFor(voiceover, alignment);
  const asSpoken = (phrase: string) =>
    spoken.converted ? spellNumbers(phrase) : phrase;
  const normalized = normalize(spoken.text);
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

    const hit = findPhrase(haystack, asSpoken(phrase), cursor);
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

    const seconds = charIndexToSeconds(alignment, hit.index, spoken.text.length);
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

/**
 * A block of subtitle text that stays on screen as a unit.
 *
 * The first version slid a window of words along and re-centred it on every
 * spoken word, so the whole line jumped roughly three times a second — the
 * highlight was the only stable thing on screen. Subtitles have to hold still
 * long enough to be read: text is grouped into two-line blocks up front, each
 * block holds for as long as its words are being spoken, and only the
 * highlight moves within it.
 */
export type CaptionPage = {
  words: WordTiming[];
  /** Index into `words` of the first word on the second line. */
  breakAt: number;
  start: number;
  end: number;
};

/** Characters that comfortably fit one line at the caption's type size. */
const LINE_CHARS = 38;
/** Never hold a block longer than this, even if the speaker pauses. */
const MAX_PAGE_SECONDS = 6;

export function captionPages(words: WordTiming[]): CaptionPage[] {
  const pages: CaptionPage[] = [];
  let current: WordTiming[] = [];
  let lineChars = 0;
  let lines = 1;

  const flush = () => {
    if (current.length === 0) return;
    // Split the block into two balanced lines.
    const total = current.reduce((n, w) => n + w.word.length + 1, 0);
    let running = 0;
    let breakAt = current.length;
    for (let i = 0; i < current.length; i++) {
      running += current[i].word.length + 1;
      if (running >= total / 2) {
        breakAt = i + 1;
        break;
      }
    }
    pages.push({
      words: current,
      breakAt: Math.min(breakAt, current.length),
      start: current[0].start,
      end: current[current.length - 1].end,
    });
    current = [];
    lineChars = 0;
    lines = 1;
  };

  for (const word of words) {
    const next = lineChars + word.word.length + 1;
    const tooWide = next > LINE_CHARS;
    const tooLong =
      current.length > 0 && word.end - current[0].start > MAX_PAGE_SECONDS;

    if (tooLong || (tooWide && lines === 2)) {
      flush();
    } else if (tooWide) {
      lines = 2;
      lineChars = 0;
    }

    current.push(word);
    lineChars += word.word.length + 1;
  }
  flush();

  return pages;
}
