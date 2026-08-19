import { resolveStoryTiming, type StoryProject } from "./story";

/**
 * Subtitles, out of what the format already knows.
 *
 * Nothing has to be transcribed or aligned: this format wrote its own cut, and
 * a `cue` is the second at which a shot's sentence begins. A subtitle track is
 * therefore the same data read a different way — which is also why it is only
 * available once the voice exists, because before that the cut is an estimate
 * from word counts rather than a measurement.
 *
 * The WRITTEN text is used, not the spoken one. The voice is given
 * "siebzehnhundertneunundachtzig" because it cannot be trusted with digits; a
 * reader wants to see "1789". See lib/say-numbers.ts.
 */

/**
 * Longest a line may be before it is wrapped.
 *
 * Forty-two characters is the broadcast convention and roughly what fits
 * across a phone in landscape without the text shrinking. Two lines at most —
 * a third covers the picture the subtitle is supposed to accompany.
 */
const LINE = 42;
const MAX_LINES = 2;

/** Shortest a subtitle may stay up, in seconds, whatever the cut says. */
const MIN_SECONDS = 1.0;

/** A frame's worth of gap, so two subtitles never share a moment. */
const GAP = 0.04;

export type SubtitleCue = { index: number; from: number; to: number; text: string };

export function subtitleCues(project: StoryProject): SubtitleCue[] {
  const timing = resolveStoryTiming(project);
  const fps = project.fps;

  // The measured cut when there is one, the estimated one otherwise — the
  // studio only offers this once the voice exists, but the arithmetic should
  // not depend on that promise being kept.
  const starts = project.cues?.length === project.shots.length
    ? project.cues
    : timing.shots.map((s) => s.from / fps);

  const end = project.audioSeconds ?? timing.totalFrames / fps;

  return project.shots.map((shot, i) => {
    const from = starts[i];
    const next = i + 1 < starts.length ? starts[i + 1] : end;
    return {
      index: i + 1,
      from,
      // Never longer than its own shot, never shorter than a glance. The
      // minimum can push a subtitle past the next one's start, so the gap is
      // applied afterwards.
      to: Math.max(from + MIN_SECONDS, next - GAP),
      text: wrap(shot.text.trim()),
    };
  });
}

/**
 * Break a line in two without splitting a word.
 *
 * Balanced rather than greedy: a greedy break leaves "Die Ägypter bauten ihre
 * Häuser aus dickem" over "Nil-Lehm", which reads worse than two halves of
 * similar length even though both are legal.
 */
function wrap(text: string): string {
  if (text.length <= LINE) return text;

  const words = text.split(/\s+/);
  let best = "";
  let bestDelta = Infinity;

  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(" ");
    const b = words.slice(i).join(" ");
    if (a.length > LINE || b.length > LINE * MAX_LINES) continue;
    const delta = Math.abs(a.length - b.length);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = `${a}\n${b}`;
    }
  }

  // Nothing legal to be found — a single word longer than the line, or a
  // sentence too long for two. Better whole and overlong than chopped.
  return best || text;
}

/** hh:mm:ss,mmm — SubRip's own shape, comma and all. */
function stamp(seconds: number): string {
  const total = Math.max(0, seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = Math.floor(total % 60);
  const ms = Math.round((total - Math.floor(total)) * 1000);
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms, 3)}`;
}

/**
 * The file itself.
 *
 * SubRip rather than WebVTT: YouTube accepts both, and SubRip is the one every
 * other editor, player and platform also takes without argument.
 */
export function toSrt(project: StoryProject): string {
  return (
    subtitleCues(project)
      .map(
        (cue) =>
          `${cue.index}\n${stamp(cue.from)} --> ${stamp(cue.to)}\n${cue.text}\n`,
      )
      .join("\n") + "\n"
  );
}

/** A filename YouTube and a human can both live with. */
export function subtitleFilename(project: StoryProject): string {
  const slug = project.title
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${slug || "untertitel"}.de.srt`;
}
