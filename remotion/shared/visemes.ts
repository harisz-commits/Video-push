import type { Alignment } from "../../lib/schema";

/**
 * Mouth shapes, driven straight off the ElevenLabs character timestamps.
 *
 * We already know which character is being spoken at any moment — that is what
 * the whole scene-timing system runs on. German orthography is close enough to
 * its pronunciation that a letter is a usable stand-in for a phoneme here: the
 * eye reads "the mouth is moving with the voice", not "that is the wrong shape
 * for a velar fricative". A real phoneme model would buy accuracy nobody can
 * see at twenty-four pixels of mouth.
 */
export type Viseme =
  | "rest"
  | "closed"
  | "open"
  | "wide"
  | "round"
  | "small"
  | "teeth";

export function visemeForChar(raw: string): Viseme {
  const c = raw.toLowerCase();

  if (/[\s]/.test(c)) return "rest";
  if (/[.,;:!?…"„"'()\-–—]/.test(c)) return "rest";

  if ("aàáâ".includes(c)) return "open";
  if ("äeéèê".includes(c)) return "wide";
  if ("iíìjy".includes(c)) return "wide";
  if ("oóòôö".includes(c)) return "round";
  if ("uúùûü".includes(c)) return "small";

  if ("mbp".includes(c)) return "closed";
  if ("fvw".includes(c)) return "teeth";
  if ("szß".includes(c)) return "wide";

  // Everything else is a consonant that barely parts the lips.
  return "open";
}

/** Index of the character being spoken at `seconds`, or -1 between words. */
function charIndexAt(alignment: Alignment, seconds: number): number {
  const starts = alignment.startTimesSeconds;
  if (starts.length === 0) return -1;

  let lo = 0;
  let hi = starts.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (starts[mid] <= seconds) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (found < 0) return -1;
  // Past the end of the last character with nothing following: silence.
  if (seconds > (alignment.endTimesSeconds[found] ?? 0) + 0.25) return -1;
  return found;
}

export function visemeAt(
  alignment: Alignment | undefined,
  seconds: number,
): Viseme {
  if (!alignment) return "rest";
  const index = charIndexAt(alignment, seconds);
  if (index < 0) return "rest";
  return visemeForChar(alignment.characters[index] ?? " ");
}

/** True while anything at all is being said — drives posture and gestures. */
export function isSpeaking(
  alignment: Alignment | undefined,
  seconds: number,
): boolean {
  if (!alignment) return false;
  return charIndexAt(alignment, seconds) >= 0;
}
