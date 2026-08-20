import { mp3Duration } from "./mp3";
import { lookup, noteUse, remember } from "./image-library";
import type { StoryProject, StorySound } from "./story";

/**
 * Sound design, generated.
 *
 * The thing this format was missing most. A film of drawn stills has no motion
 * of its own to carry tension, so it has to come from somewhere else: from the
 * cut, from the camera drifting across the picture, and above all from what
 * you hear. Wind over snow under a whole passage, a bone cracking exactly on
 * the sentence that says so — that is the difference between a slideshow and
 * something that holds people.
 *
 * Two kinds, and they behave differently:
 *
 *   - a BED runs continuously under a passage. Generated short and looped,
 *     because two minutes of wind costs as much as two minutes of narration
 *     and is indistinguishable from ten seconds of it repeated.
 *
 *   - an ACCENT is a single hit on a single shot. Short, sparse, and the
 *     reason the format has punctuation at all.
 *
 * Measured price: about 48 characters of the ElevenLabs allowance per second
 * of sound. A ten-second bed is roughly 480, a two-second hit roughly 96 — so
 * a whole film's sound design costs a fraction of its narration, and less
 * again once the library starts answering.
 */

const ENDPOINT = "https://api.elevenlabs.io/v1/sound-generation";

/**
 * How the cost is worked out lives in lib/sfx-cost.ts, and is re-exported
 * here so callers that already had it keep it. The split is not cosmetic:
 * this module reaches the picture library and through it an image encoder,
 * and the studio — which only ever wanted the number — was dragging all of
 * that into the browser bundle.
 */
export { CHARS_PER_SECOND, soundCost } from "./sfx-cost";
import { CHARS_PER_SECOND } from "./sfx-cost";

/**
 * How many are generated at once.
 *
 * Two, for the same reason the narration uses two: the lower ElevenLabs tiers
 * cap concurrent requests, and a refusal here costs a sound rather than
 * delaying one.
 */
const LANES = 2;

/**
 * The style every sound is asked in.
 *
 * Appended to each prompt, exactly as the image directive is: without it the
 * model returns cinematic stings and musical risers — trailer sound — which
 * fight the narration instead of sitting under it.
 */
const SOUND_STYLE =
  "Natural, realistic, documentary sound. No music, no melody, no cinematic " +
  "riser or sting, no speech, no voices. Clean, dry recording with no " +
  "reverb tail added, suitable to sit quietly under a narrator.";

export type SfxResult = {
  project: StoryProject;
  /** Sounds actually paid for. */
  made: number;
  /** Sounds that came out of the library for free. */
  reused: number;
  /** Characters of the ElevenLabs allowance spent. */
  characters: number;
  failed: { key: string; reason: string }[];
  skipped: number;
};

export async function generateSounds(args: {
  project: StoryProject;
  apiKey: string;
  deadline?: number;
  onProgress?: (done: number, total: number) => Promise<void>;
}): Promise<SfxResult> {
  const style = args.project.style.name;
  const wanted = args.project.sounds.filter((s) => !s.url);

  const made = new Map<
    string,
    { url: string; seconds: number; reused: boolean }
  >();
  let paid = 0;
  let reused = 0;
  let characters = 0;
  let skipped = 0;
  let next = 0;
  const failed: { key: string; reason: string }[] = [];

  const lane = async () => {
    for (;;) {
      const index = next++;
      if (index >= wanted.length) return;

      if (args.deadline && Date.now() > args.deadline) {
        skipped += 1;
        continue;
      }

      const sound = wanted[index];

      // The library first, keyed by sound AND style — a bed of wind belongs to
      // the film it was made for, and the same key in a different look may
      // well have been asked for something else entirely.
      const known = await lookup(soundKey(sound), style).catch(() => null);
      if (known) {
        made.set(sound.key, {
          url: known.url,
          // Stored in the entry's name field; see remember() below.
          seconds: Number(known.prompt.split("|").pop()) || sound.seconds,
          reused: true,
        });
        reused += 1;
        await noteUse(soundKey(sound), style).catch(() => undefined);
        await args.onProgress?.(made.size + failed.length, wanted.length);
        continue;
      }

      try {
        const response = await fetch(ENDPOINT, {
          method: "POST",
          headers: {
            "xi-api-key": args.apiKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            text: `${sound.prompt.trim()} ${SOUND_STYLE}`,
            duration_seconds: Math.min(22, Math.max(0.5, sound.seconds)),
            // Low, so the description is followed rather than embellished.
            // High values make the model "interpret", which for a bed of wind
            // means adding a storm.
            prompt_influence: 0.4,
          }),
        });

        if (!response.ok) {
          const detail = await response.text().catch(() => "");
          throw new Error(`HTTP ${response.status} ${detail.slice(0, 160)}`);
        }

        const audio = Buffer.from(await response.arrayBuffer());
        const seconds = mp3Duration(audio) || sound.seconds;
        characters += Math.round(sound.seconds * CHARS_PER_SECOND);

        const entry = await remember({
          key: soundKey(sound),
          name: sound.name,
          // The real length is carried on the entry so a reuse knows where the
          // loop restarts without fetching and measuring the file again.
          prompt: `${sound.prompt}|${seconds.toFixed(3)}`,
          style,
          model: "eleven-sound-generation",
          bytes: audio,
          contentType: "audio/mpeg",
        });

        made.set(sound.key, { url: entry.url, seconds, reused: false });
        paid += 1;
      } catch (err) {
        // One sound that will not generate must not cost the rest. The shot
        // keeps its key, finds no url, and simply plays nothing.
        failed.push({ key: sound.key, reason: (err as Error).message.slice(0, 160) });
      }

      await args.onProgress?.(made.size + failed.length, wanted.length);
    }
  };

  await Promise.all(Array.from({ length: Math.min(LANES, wanted.length) }, lane));

  return {
    project: {
      ...args.project,
      sounds: args.project.sounds.map((sound) => {
        const hit = made.get(sound.key);
        return hit
          ? {
              ...sound,
              url: hit.url,
              audioSeconds: hit.seconds,
              reused: hit.reused,
            }
          : sound;
      }),
    },
    made: paid,
    reused,
    characters,
    failed,
    skipped,
  };
}

/**
 * The library key for a sound.
 *
 * Prefixed, because the library holds pictures under the same names. Without
 * it a bed called "lagerfeuer" and a picture called "lagerfeuer" would collide
 * and one of them would come back as the other — silently, and as the wrong
 * kind of file entirely.
 */
function soundKey(sound: StorySound): string {
  return `sfx-${sound.kind}-${sound.key}`;
}

/** What generating the missing sounds would cost right now. */

