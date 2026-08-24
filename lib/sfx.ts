import { mp3Duration } from "./mp3";
import type { LibraryEntry } from "./image-library";
import {
  lookup,
  lookupAnyStyle,
  noteUse,
  readLibrary,
  rebucket,
  remember,
} from "./image-library";
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
 * The bucket every sound is filed under, regardless of the film.
 *
 * Sounds used to be filed under the film's VISUAL style — "Sand und Indigo,
 * Siebdruck" — with the comment that a bed of wind belongs to the film it was
 * made for. That reasoning is right for a picture and nonsense for a sound: a
 * picture in the wrong palette is the wrong picture, while wind sounds the
 * same whether the film is ochre or blue. The effect was that every film with
 * a new look regenerated its wind, its fire and its water, and paid for them
 * again.
 *
 * One bucket, so a sound made for any film is available to every later one.
 */
const SFX_STYLE = "sfx";

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

/**
 * Und der Stil fürs Finanz-Format: leise Musik statt Umgebung.
 *
 * Genau umgekehrt zu oben, und aus demselben Grund. Unter einem Film über
 * Ägypten trägt ein Wind, weil es dort Wind gab; unter einem Diagramm über
 * Sparraten gibt es nichts, was klingt. Ein Raumton unter einer Zinskurve ist
 * entweder unhörbar oder er behauptet einen Ort, den es nicht gibt.
 *
 * Was hier ausdrücklich nicht gewollt ist, steht mit drin: keine Melodie, die
 * man mitsummt, kein Aufbau, kein Schlagzeug. Der Teppich soll auffallen,
 * wenn man ihn abschaltet, und sonst nicht.
 */
const MUSIC_STYLE =
  "Calm, minimal instrumental underscore. Soft sustained pads and a gentle " +
  "low pulse, slow and even. No melody or hook to follow, no build, no drop, " +
  "no drums or percussion hits, no risers, no speech, no voices. Even " +
  "loudness from start to end so it loops without a seam, mixed to sit far " +
  "below a narrator.";

/** Welcher Stil an die Beschreibung gehängt wird. */
function styleFor(project: StoryProject, sound: StorySound): string {
  // Nur der Teppich wird beim Finanz-Format Musik. Ein Akzent bleibt ein
  // Geräusch — wenn im Text eine Münze fällt, soll eine Münze fallen.
  return project.kind === "finanz" && sound.kind === "ambience"
    ? MUSIC_STYLE
    : SOUND_STYLE;
}

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

      // The library first. In the sound bucket, and failing that anywhere at
      // all — sounds made before the bucket existed are filed under whichever
      // film's look happened to be current, and they are perfectly good
      // sounds. A hit outside the bucket is moved into it on the spot, so the
      // fallback stops being needed as the old entries get reused.
      const key = soundKey(args.project, sound);
      let known = await lookup(key, SFX_STYLE).catch(() => null);
      if (!known) {
        known = await lookupAnyStyle(key).catch(() => null);
        if (known) await rebucket(key, SFX_STYLE).catch(() => undefined);
      }

      // Second net: the same sound under a different name.
      //
      // The writer is shown the library and told to copy the key verbatim, and
      // mostly does. The failure that survives that is copying the DESCRIPTION
      // and renaming the key — "wind-ueber-schnee" becomes
      // "heulender-wind-eisflaeche" while the English prompt is word for word
      // the one it was given. The key lookup misses and the identical sound is
      // generated and paid for again.
      //
      // Matched on the exact description, not on similarity. A fuzzy match
      // would sometimes substitute a sound that is merely close, and a wrong
      // sound nobody notices until the video is finished costs far more than
      // the four cents it saved.
      if (!known) known = await lookupByDescription(sound).catch(() => null);

      if (known) {
        made.set(sound.key, {
          url: known.url,
          // Stored after a pipe in the prompt field; see remember() below.
          seconds: Number(known.prompt.split("|").pop()) || sound.seconds,
          reused: true,
        });
        reused += 1;
        await noteUse(key, SFX_STYLE).catch(() => undefined);
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
            text: `${sound.prompt.trim()} ${styleFor(args.project, sound)}`,
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
          key: soundKey(args.project, sound),
          name: sound.name,
          // The real length is carried on the entry so a reuse knows where the
          // loop restarts without fetching and measuring the file again.
          prompt: `${sound.prompt}|${seconds.toFixed(3)}`,
          style: SFX_STYLE,
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
 * What the sound library already holds, in the shape a writer can use.
 *
 * This is the point of the whole exercise. Matching on the exact key almost
 * never fires across films: one script calls its bed "wind-ueber-schnee" and
 * the next calls the same thing "pfeifender-wind-eisflaeche", and both pay
 * ElevenLabs for a sound that already exists. So the writer is shown what is
 * there, in English, and told to reuse by name — the same mechanism that
 * already makes motifs come back within a film, which is the one thing here
 * that is known to work.
 *
 * A model reading "howling wind sweeping across an open snow field" knows
 * perfectly well that it is the bed the next Ice Age film wants. No embedding
 * store, no similarity threshold to tune, and it fails in the harmless
 * direction: an unrecognised sound is simply generated as before.
 */
export type KnownSound = {
  /** Without the sfx- prefix, which is what a script writes. */
  key: string;
  name: string;
  /** The English description it was generated from. */
  description: string;
  kind: "ambience" | "accent";
  /** Ob dieser Teppich Musik ist. Siehe soundKey(). */
  music: boolean;
  seconds: number;
  uses: number;
};

/** How many of each kind are offered. Enough to be useful, short enough to read. */
const OFFERED = 40;

/**
 * One library entry read back as a sound, or null if it is not one.
 *
 * Exported because it is the only fiddly part: the key carries the kind in a
 * prefix and the real duration was appended to the prompt after a pipe, both
 * to avoid widening the library's shape for one of its two tenants. Getting
 * either wrong offers the writer a description with a number stuck on the end,
 * which it would then copy into a prompt and generate.
 */
export function parseSound(entry: {
  key: string;
  name: string;
  prompt: string;
  uses: number;
}): KnownSound | null {
  const match = /^sfx-(ambience|musik|accent)-([a-z0-9][a-z0-9-]*)$/.exec(entry.key);
  if (!match) return null;

  const [, bucket, key] = match;
  // "musik" ist ein eigener Eimer in der Bibliothek, aber im Projekt ist es
  // ein Klangteppich wie jeder andere. Siehe soundKey().
  const kind = bucket === "musik" ? "ambience" : bucket;
  const music = bucket === "musik";
  // Split from the right: a description may itself contain a pipe, the
  // duration never does.
  const parts = entry.prompt.split("|");
  const seconds = parts.length > 1 ? Number(parts[parts.length - 1]) : NaN;
  const description = (
    parts.length > 1 && Number.isFinite(seconds)
      ? parts.slice(0, -1).join("|")
      : entry.prompt
  ).trim();
  if (description.length < 4) return null;

  return {
    key,
    name: entry.name,
    description,
    kind: kind as KnownSound["kind"],
    music,
    seconds: Number.isFinite(seconds) && seconds > 0 ? seconds : 10,
    uses: entry.uses,
  };
}

export async function soundLibrary(options?: {
  /**
   * Welche Teppiche angeboten werden.
   *
   * Muss getrennt sein: einem Finanzskript „Wind über Dünen" als vorhandenen
   * Teppich anzubieten, führt dazu, dass es ihn wörtlich übernimmt — und
   * erzeugt wird er dann trotzdem neu, weil Musik in einem anderen Eimer der
   * Bibliothek liegt. Ein Angebot, das nie zutrifft, kostet Geld und sieht
   * aus wie Sparsamkeit.
   */
  music?: boolean;
}): Promise<{
  beds: KnownSound[];
  accents: KnownSound[];
}> {
  const wantMusic = options?.music === true;
  const { entries } = await readLibrary().catch(() => ({ entries: [] }));
  const beds: KnownSound[] = [];
  const accents: KnownSound[] = [];

  for (const entry of entries) {
    const sound = parseSound(entry);
    if (!sound) continue;
    if (sound.kind === "ambience") {
      if (sound.music === wantMusic) beds.push(sound);
    } else {
      accents.push(sound);
    }
  }

  // Proven first. A sound that has already been used in three films is a
  // better offer than one that was made once and never came back — and when
  // the list has to be cut, that is the right end to cut from.
  const rank = (a: KnownSound, b: KnownSound) => b.uses - a.uses;
  return {
    beds: beds.sort(rank).slice(0, OFFERED),
    accents: accents.sort(rank).slice(0, OFFERED),
  };
}

/**
 * A stored sound whose description matches this one exactly.
 *
 * Normalised only for case and whitespace — a model that copies a prompt and
 * changes its capitalisation has still copied it, while one that rewords it
 * has asked for something else and should get something else.
 */
async function lookupByDescription(
  sound: StorySound,
): Promise<LibraryEntry | null> {
  const wanted = normalise(sound.prompt);
  if (wanted.length < 8) return null;

  const { entries } = await readLibrary();
  const hit = entries
    .map((entry) => ({ entry, parsed: parseSound(entry) }))
    .filter(
      (row) =>
        row.parsed &&
        row.parsed.kind === sound.kind &&
        normalise(row.parsed.description) === wanted,
    )
    .sort((a, b) => b.entry.uses - a.entry.uses)[0];

  return hit ? hit.entry : null;
}

const normalise = (text: string) =>
  text.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * The library key for a sound.
 *
 * Prefixed, because the library holds pictures under the same names. Without
 * it a bed called "lagerfeuer" and a picture called "lagerfeuer" would collide
 * and one of them would come back as the other — silently, and as the wrong
 * kind of file entirely.
 */
function soundKey(project: StoryProject, sound: StorySound): string {
  // Musik bekommt einen eigenen Namensraum in der Bibliothek. Sonst teilte
  // sich ein „ruhiger-puls" aus einem Finanzvideo den Eintrag mit einem
  // gleichnamigen Raumton aus einem Erklärfilm — und der zweite bekäme
  // stillschweigend die Datei des ersten, mit dem falschen Charakter.
  const kind =
    project.kind === "finanz" && sound.kind === "ambience"
      ? "musik"
      : sound.kind;
  return `sfx-${kind}-${sound.key}`;
}

/** What generating the missing sounds would cost right now. */

