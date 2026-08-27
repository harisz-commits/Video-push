import { del, head, list } from "@vercel/blob";
import { readJson, resolveBlobToken, writeBinary, writeJson } from "./store";

/**
 * Every picture this studio has ever drawn, by name.
 *
 * The reason it exists is arithmetic. A twenty-five minute video changes
 * picture every two to four seconds, which is five hundred images, which at
 * Nano Banana 2 Lite is seventeen dollars — every time, including the second
 * video about the same subject. A named picture that survives its video turns
 * the second Egypt film into a handful of new drawings plus a hundred it
 * already owns.
 *
 * Names are the whole mechanism. "aegypten-lehmziegelhaus-seitlich" can be
 * looked up, recognised in a list, reused on purpose and redrawn when it is
 * wrong. "image-47.png" can only be paid for again.
 *
 * The catalogue is one small JSON document rather than a listing of the blob
 * store: a listing gives filenames, and what a later video needs to search is
 * what the picture SHOWS and which style it was drawn in — an Egyptian mud
 * brick house in the sand-and-ochre style is not a substitute for the same
 * house in a cold blue one.
 */

const INDEX = "library/index.json";
const IMAGE_PREFIX = "library/img/";
const THUMB_PREFIX = "library/thumb/";

/**
 * Where sounds go, and why they are not under library/img/ any more.
 *
 * They were, with a .png name, because the library was written for pictures
 * and the sounds moved in later. The content type was set correctly to
 * audio/mpeg, the browser played them from the header, and everything looked
 * fine: audible in the studio, audible in the library, audible in the
 * preview.
 *
 * Silent in every rendered video. Remotion decides what an asset IS from its
 * extension, so a .png was collected as a picture and contributed nothing to
 * the audio mix. Measured on a deliberately loud sound, identical bytes, one
 * variable changed:
 *
 *   as .png -> -99.0 dB peak   (digital silence)
 *   as .mp3 ->  -0.0 dB peak   (audible)
 *
 * It cost a whole rendered film its entire sound design, and it looked like a
 * Remotion bug rather than a naming mistake because the only place it showed
 * was the one place nobody checks twice.
 */
const SOUND_PREFIX = "library/sfx/";

/**
 * How wide a stored thumbnail is.
 *
 * The studio shows the picture list at 48 pixels wide and was downloading the
 * original for each row — a seventy-five picture film meant roughly a hundred
 * megabytes of blob traffic every time somebody opened the project. Measured
 * on one day, blob downloads were the second largest line on the bill at
 * $1.14, or 22.8 GB.
 *
 * Three hundred and twenty is far more than the list needs and still about a
 * hundredth of the original, which leaves room to show the picture bigger
 * later without going back to the full file.
 */
const THUMB_WIDTH = 320;

export type LibraryEntry = {
  key: string;
  /** Plain-language name, as the studio shows it. */
  name: string;
  /** The subject prompt, without the style directive. */
  prompt: string;
  /**
   * Which look it was drawn in.
   *
   * Stored as the style's name rather than the whole directive, because this
   * is what a lookup compares: a picture is only reusable in a video whose
   * style it already matches, and comparing two thousand-character directives
   * would make near-misses look like matches.
   */
  style: string;
  url: string;
  /**
   * A small copy, for lists.
   *
   * Optional because entries written before thumbnails existed have none, and
   * because making one must never be able to fail a drawing that has already
   * been paid for. Anything reading this falls back to `url`.
   */
  thumbUrl?: string;
  model: string;
  /**
   * What the look was when this was drawn, beyond its name.
   *
   * The style name alone stopped being enough the moment the directive, the
   * palette and the characters became editable by hand. A film can now keep
   * the name "Sand und Indigo, Siebdruck" and mean something visibly
   * different — and a lookup on the name alone would answer with the old
   * picture, silently, which is the exact failure the style match was added to
   * prevent.
   *
   * Optional because entries written before this existed have no fingerprint
   * and are trusted: they were drawn when a style could not be edited, so
   * their name really did pin their look.
   */
  fingerprint?: string;
  createdAt: number;
  /** How often it has been used since. Only for showing what is earning its keep. */
  uses: number;
};

export type LibraryIndex = { entries: LibraryEntry[]; updatedAt: number };

/**
 * The queue every change to the index has to pass through.
 *
 * The index is one JSON document and every change is read-modify-write. Three
 * pictures are drawn at once, so three lanes read the same index, each adds its
 * own entry, and each writes the whole thing back — the last writer wins and
 * the other two entries are gone. Not a theory: measured on the live library,
 * a film that paid for seventy-five pictures had four of them indexed, and
 * another with twelve had two. The files were all there; only the list of what
 * exists had been overwritten into nothing.
 *
 * A promise chain rather than a lock, because that is all a single Node process
 * needs: each change waits for the one before it, so read and write are never
 * separated by another change. It does not protect against two concurrent
 * *requests* — but drawing a film is one request with three lanes, which is the
 * case that was losing entries every single time, rather than rarely.
 *
 * Every change goes through here. A single write that forgets to is enough to
 * throw away whatever the queue was holding.
 */
let queue: Promise<unknown> = Promise.resolve();

function serialise<T>(change: () => Promise<T>): Promise<T> {
  const next = queue.then(change, change);
  // Kept alive as a settled promise whatever happens, so one failed change
  // does not deadlock every later one behind a rejection.
  queue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

export async function readLibrary(): Promise<LibraryIndex> {
  const index = await readJson<LibraryIndex>(INDEX).catch(() => null);
  return index && Array.isArray(index.entries)
    ? index
    : { entries: [], updatedAt: 0 };
}

/**
 * A picture already drawn for this subject in this look, or nothing.
 *
 * Matched on the key AND the style, never on the key alone. The same subject
 * drawn in a different look is the wrong picture — putting it in would produce
 * exactly the mismatch this format is built to avoid, and it would do it
 * silently, which is worse than an extra three cents.
 */
export async function lookup(
  key: string,
  style: string,
  /** The look's fingerprint. See LibraryEntry.fingerprint. */
  fingerprint?: string,
): Promise<LibraryEntry | null> {
  const { entries } = await readLibrary();
  return (
    entries.find(
      (e) =>
        e.key === key &&
        e.style === style &&
        (e.fingerprint === undefined ||
          fingerprint === undefined ||
          e.fingerprint === fingerprint),
    ) ?? null
  );
}

/**
 * The same lookup, ignoring the look entirely.
 *
 * Only safe for things that have no look. A picture asked for by key alone
 * would come back in whatever palette it happened to be drawn in, which is the
 * exact mistake the style match exists to prevent — but a sound has no palette.
 * Wind does not sound different because the film is ochre instead of blue.
 *
 * Used for the sounds, whose keys carry an `sfx-` prefix and therefore cannot
 * collide with a picture's.
 */
export async function lookupAnyStyle(key: string): Promise<LibraryEntry | null> {
  const { entries } = await readLibrary();
  // Most used first: when the same sound was stored under several film styles
  // — which is what happened before sounds were given a bucket of their own —
  // the one that has proven itself is the better answer.
  return (
    entries
      .filter((e) => e.key === key)
      .sort((a, b) => b.uses - a.uses)[0] ?? null
  );
}

/**
 * Move an entry into a different bucket, keeping everything else.
 *
 * Lazy migration, and the reason the fallback above does not have to live
 * forever: a sound found under an old film's style name is re-filed under the
 * sound bucket the first time it is reused, so the next lookup finds it
 * directly. Best effort — a failure costs one more fallback, not the entry.
 */
export async function rebucket(key: string, style: string): Promise<void> {
  await serialise(async () => {
    const index = await readLibrary();
    const entry = index.entries.find((e) => e.key === key);
    if (!entry || entry.style === style) return;
    entry.style = style;
    await writeJson(INDEX, {
      ...index,
      updatedAt: Date.now(),
    } satisfies LibraryIndex);
  }).catch(() => {
    // Costs one more fallback lookup next time, not the entry.
  });
}

/** Every picture drawn in one look, for offering reuse in a new video. */
export async function inStyle(style: string): Promise<LibraryEntry[]> {
  const { entries } = await readLibrary();
  return entries.filter((e) => e.style === style);
}

/**
 * Store a freshly drawn picture under its name.
 *
 * Written to the blob store first and indexed second, deliberately: an entry
 * pointing at a file that does not exist would be looked up, trusted, and put
 * into a video as a broken image. A file with no entry is merely three cents
 * nobody can find again, which the next sweep collects.
 */
export async function remember(args: {
  key: string;
  name: string;
  prompt: string;
  style: string;
  fingerprint?: string;
  model: string;
  bytes: Buffer;
  contentType?: string;
}): Promise<LibraryEntry> {
  // The fingerprint is part of the filename as well as the index, so a redraw
  // under an edited style writes a new file instead of overwriting the picture
  // that other, older projects are still pointing at. Built by libraryPath()
  // rather than spelled out here, because findStored() has to be able to
  // compute the identical name - if the two ever drift, a picture that exists
  // becomes unfindable and is paid for again.
  const url = await writeBinary(
    libraryPath(args.key, args.style, args.fingerprint),
    args.bytes,
    args.contentType ?? "image/png",
  );

  const entry: LibraryEntry = {
    key: args.key,
    name: args.name,
    prompt: args.prompt,
    style: args.style,
    fingerprint: args.fingerprint,
    url,
    thumbUrl: await makeThumb(
      thumbPath(args.key, args.style, args.fingerprint),
      args.bytes,
      args.contentType ?? "image/png",
    ),
    model: args.model,
    createdAt: Date.now(),
    uses: 1,
  };

  // Reading the index and writing it back is one indivisible step. See
  // serialise() — this is the write that was losing entries.
  await serialise(async () => {
    const index = await readLibrary();
    // Replaced rather than appended when it already exists: a redraw of the
    // same subject in the same look is a correction, and keeping both would
    // leave the old one to be found by the next lookup.
    const entries = index.entries.filter(
      (e) =>
        !(
          e.key === entry.key &&
          e.style === entry.style &&
          e.fingerprint === entry.fingerprint
        ),
    );
    entries.push(entry);

    await writeJson(INDEX, {
      entries,
      updatedAt: Date.now(),
    } satisfies LibraryIndex);
  }).catch(() => {
    // The file is written and the caller gets its URL either way. An entry
    // that could not be indexed is a picture the library will not offer —
    // recoverable later from the project, which is what reindex() is for.
  });

  return entry;
}

/** Note that a stored picture was used again, for the studio's list. */
export async function noteUse(key: string, style: string): Promise<void> {
  await serialise(async () => {
    const index = await readLibrary();
    const entry = index.entries.find((e) => e.key === key && e.style === style);
    if (!entry) return;
    entry.uses += 1;
    await writeJson(INDEX, {
      ...index,
      updatedAt: Date.now(),
    } satisfies LibraryIndex);
  }).catch(() => {
    // A lost count costs a number on a screen.
  });
}

/**
 * Turn a name into a key.
 *
 * German, so the umlauts have to be spelled rather than stripped — "Ägypten"
 * losing its first letter would collide with anything starting in "gypten",
 * and a key collision in a library keyed by meaning puts the wrong picture on
 * screen.
 */
export function slugify(name: string): string {
  const s = name
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
  return s.length >= 3 ? s : `bild-${Date.now().toString(36)}`;
}

/**
 * Where a picture lands, worked out rather than remembered.
 *
 * Blob paths here are written with addRandomSuffix off, so the same subject in
 * the same look always occupies the same path. That makes the file itself
 * findable without the index - which matters far more than it sounds, because
 * the index turned out to be the unreliable part while the files were never
 * lost at all.
 */
export function libraryPath(
  key: string,
  style: string,
  fingerprint?: string,
  /** Sounds are named .mp3 and live elsewhere. See SOUND_PREFIX. */
  sound = key.startsWith("sfx-"),
): string {
  const tag = hash(style + (fingerprint ?? ""));
  return sound
    ? `${SOUND_PREFIX}${key}-${tag}.mp3`
    : `${IMAGE_PREFIX}${key}-${tag}.png`;
}

function thumbPath(key: string, style: string, fingerprint?: string): string {
  return `${THUMB_PREFIX}${key}-${hash(style + (fingerprint ?? ""))}.webp`;
}

/**
 * A picture that was already drawn and paid for, found by looking.
 *
 * The index says what the library believes it has; this asks storage what is
 * actually there. They came apart badly - a film that paid for seventy-five
 * pictures had four of them indexed - and when they disagree, the file is
 * right. Same principle the render code settled on: the truth about a render
 * is not a status somebody wrote down, it is whether the file exists.
 *
 * Two paths are tried, because a picture drawn before styles could be edited
 * was stored under a name that had no fingerprint in it.
 */
export async function findStored(args: {
  key: string;
  name: string;
  prompt: string;
  style: string;
  fingerprint?: string;
}): Promise<LibraryEntry | null> {
  const token = resolveBlobToken()?.value;
  if (!token) return null;

  const candidates = args.fingerprint
    ? [libraryPath(args.key, args.style, args.fingerprint), libraryPath(args.key, args.style)]
    : [libraryPath(args.key, args.style)];

  // Pictures only. A sound found by path would need its duration parsed out
  // of a prompt this does not have.
  for (const [i, pathname] of candidates.entries()) {
    const found = await head(pathname, { token }).catch(() => null);
    if (!found) continue;

    // Only the first candidate carries the fingerprint; the second is the
    // older naming and must be recorded as having none, or the next lookup
    // would compute a path that does not exist.
    const fingerprint = i === 0 ? args.fingerprint : undefined;
    const thumb = await head(thumbPath(args.key, args.style, fingerprint), {
      token,
    }).catch(() => null);

    const entry: LibraryEntry = {
      key: args.key,
      name: args.name,
      prompt: args.prompt,
      style: args.style,
      fingerprint,
      url: found.url,
      thumbUrl: thumb?.url,
      model: "wiedergefunden",
      createdAt: found.uploadedAt ? new Date(found.uploadedAt).getTime() : Date.now(),
      uses: 1,
    };

    // Put it back in the index, so the next film does not have to look.
    await serialise(async () => {
      const index = await readLibrary();
      if (index.entries.some((e) => e.url === entry.url)) return;
      await writeJson(INDEX, {
        entries: [...index.entries, entry],
        updatedAt: Date.now(),
      } satisfies LibraryIndex);
    }).catch(() => undefined);

    return entry;
  }

  return null;
}

/**
 * A small copy of a picture, or nothing.
 *
 * Never throws. The original is already written and already paid for by the
 * time this runs, and a missing thumbnail costs bandwidth in a list — losing
 * the picture over one would cost three and a half cents and a redraw. sharp
 * is loaded on demand for the same reason: this module is imported by routes
 * that never touch an image at all.
 */
async function makeThumb(
  pathname: string,
  bytes: Buffer,
  contentType: string,
): Promise<string | undefined> {
  // Sounds go through remember() too, and a WebP of an MP3 is not a thing.
  if (!contentType.startsWith("image/")) return undefined;

  try {
    const { default: sharp } = await import("sharp");
    const thumb = await sharp(bytes)
      .resize({ width: THUMB_WIDTH, withoutEnlargement: true })
      .webp({ quality: 72 })
      .toBuffer();
    return await writeBinary(pathname, thumb, "image/webp");
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[library] Miniatur fehlgeschlagen:", err);
    return undefined;
  }
}

/** A short, stable tag for a style name, so one key can hold several looks. */
function hash(style: string): string {
  let h = 2166136261;
  for (let i = 0; i < style.length; i++) {
    h ^= style.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36).slice(0, 6);
}

/**
 * Remove an entry and the file behind it.
 *
 * The index first, the file second — the opposite order from remember(), and
 * for the same reason. An index entry pointing at a deleted file would be
 * looked up, trusted, and put into a video as a broken image; a file with no
 * entry is merely storage nobody can find, which the next sweep collects.
 */
export async function deleteEntry(key: string): Promise<boolean> {
  const gone = await serialise(async () => {
    const index = await readLibrary();
    const found = index.entries.filter((e) => e.key === key);
    if (found.length === 0) return [];

    await writeJson(INDEX, {
      entries: index.entries.filter((e) => e.key !== key),
      updatedAt: Date.now(),
    } satisfies LibraryIndex);
    return found;
  });
  if (gone.length === 0) return false;

  const token = resolveBlobToken()?.value;
  if (token) {
    const urls = gone.flatMap((e) => [e.url, e.thumbUrl].filter(Boolean) as string[]);
    await del(urls, { token }).catch(() => {
      // The entry is gone either way. This costs storage, not correctness.
    });
  }
  return true;
}

/** What the library holds, for the studio to show without loading every entry. */
export async function librarySummary(): Promise<{
  count: number;
  styles: { style: string; count: number }[];
  bytes: number | null;
}> {
  const { entries } = await readLibrary();
  const byStyle = new Map<string, number>();
  for (const e of entries) byStyle.set(e.style, (byStyle.get(e.style) ?? 0) + 1);

  let bytes: number | null = null;
  const token = resolveBlobToken()?.value;
  if (token) {
    bytes = await list({ prefix: IMAGE_PREFIX, limit: 1000, token })
      .then((p) => p.blobs.reduce((sum, b) => sum + (b.size ?? 0), 0))
      .catch(() => null);
  }

  return {
    count: entries.length,
    styles: [...byStyle.entries()]
      .map(([style, count]) => ({ style, count }))
      .sort((a, b) => b.count - a.count),
    bytes,
  };
}

/**
 * Rebuild the index from what the saved projects know.
 *
 * The repair for a bug that ran for as long as this library existed: adding an
 * entry read the whole index and wrote the whole index back, three lanes did
 * it at once, and two of every three entries were overwritten before they had
 * ever been read again. Measured on the live library - a film that paid for
 * seventy-five pictures had four of them indexed, another with twelve had two.
 * The queue in serialise() stops it happening again; this gets the lost ones
 * back.
 *
 * And they genuinely can come back, because nothing was actually lost. Every
 * file is still in the blob store, and every saved project holds the whole
 * record of it: the key, the name, the prompt it was drawn from, its URL, the
 * model that drew it, and the style of the film it belongs to. That is exactly
 * an index entry. Rebuilding from the projects is not guesswork.
 *
 * What it does NOT do is invent. An entry already in the index is left alone,
 * because it may carry a use count this cannot reconstruct, and nothing here
 * is drawn, generated or paid for.
 */
export async function reindexFromProjects(): Promise<{
  scanned: number;
  images: number;
  sounds: number;
  already: number;
}> {
  const { readAllProjects } = await import("./projects");
  const { styleFingerprint } = await import("./story");

  const records = await readAllProjects();
  const found: LibraryEntry[] = [];
  let scanned = 0;

  for (const record of records) {
    const kind = (record.project as { kind?: string } | undefined)?.kind;
    if (kind !== "video") continue;
    scanned += 1;

    const video = record.project as unknown as {
      style: { name: string; directive: string; palette: string[] };
      characters?: {
        key: string;
        name: string;
        description: string;
        appearance?: string;
      }[];
      images?: {
        key: string;
        name: string;
        prompt: string;
        url?: string;
        thumbUrl?: string;
        model?: string;
        characters?: string[];
      }[];
      sounds?: {
        key: string;
        name: string;
        prompt: string;
        kind: "ambience" | "accent";
        seconds: number;
        audioSeconds?: number;
        url?: string;
      }[];
    };

    const cast = new Map((video.characters ?? []).map((c) => [c.key, c] as const));

    for (const image of video.images ?? []) {
      if (!image.url) continue;
      found.push({
        key: image.key,
        name: image.name,
        prompt: image.prompt,
        style: video.style.name,
        // Computed from the style this picture was actually drawn under rather
        // than left blank. Blank matches any later edit of the same style name
        // and would hand back a picture drawn to different instructions, which
        // is the exact thing the fingerprint exists to prevent.
        fingerprint: styleFingerprint(
          video.style,
          (image.characters ?? [])
            .map((k) => cast.get(k))
            .filter((c): c is NonNullable<typeof c> => Boolean(c)),
        ),
        url: image.url,
        thumbUrl: image.thumbUrl,
        model: image.model ?? "unbekannt",
        createdAt: record.updatedAt ?? record.createdAt ?? Date.now(),
        uses: 1,
      });
    }

    for (const sound of video.sounds ?? []) {
      if (!sound.url) continue;
      found.push({
        key: `sfx-${sound.kind}-${sound.key}`,
        name: sound.name,
        // The real duration lives after a pipe. See lib/sfx.ts.
        prompt: `${sound.prompt}|${(sound.audioSeconds ?? sound.seconds).toFixed(3)}`,
        // Sounds have no look, so they go into the sound bucket whichever film
        // they were made for.
        style: "sfx",
        url: sound.url,
        model: "eleven-sound-generation",
        createdAt: record.updatedAt ?? record.createdAt ?? Date.now(),
        uses: 1,
      });
    }
  }

  return serialise(async () => {
    const index = await readLibrary();

    // Matched on the URL, not on key and style and fingerprint.
    //
    // The URL is the file, and the file is what an entry is for - two entries
    // pointing at the same blob are the same picture however they are
    // labelled. The composite key gets this wrong in exactly the case that
    // matters here: entries written before fingerprints existed carry none,
    // the rebuilt ones compute theirs, and every single survivor of the old
    // index would be duplicated. Checked against the live library: six entries
    // survived, and all six share their URL with the project they came from.
    const known = new Set(index.entries.map((e) => e.url));

    let images = 0;
    let sounds = 0;
    let already = 0;
    const added: LibraryEntry[] = [];

    for (const entry of found) {
      if (known.has(entry.url)) {
        already += 1;
        continue;
      }
      known.add(entry.url);
      added.push(entry);
      if (entry.key.startsWith("sfx-")) sounds += 1;
      else images += 1;
    }

    if (added.length > 0) {
      await writeJson(INDEX, {
        entries: [...index.entries, ...added],
        updatedAt: Date.now(),
      } satisfies LibraryIndex);
    }

    return { scanned, images, sounds, already };
  });
}

/**
 * Move the sounds to a name a renderer recognises.
 *
 * Repairs what SOUND_PREFIX describes: every sound generated before that fix
 * sits under library/img/ with a .png name and is dropped by Remotion, so
 * every film rendered so far has no sound design at all. The bytes are fine -
 * only the name is wrong - so this copies each one to its proper .mp3 path and
 * points the index and the saved projects at it.
 *
 * The old file is left where it is. Deleting it would save a few kilobytes and
 * risks breaking a render that is in flight against the old URL, which is a
 * bad trade in both directions.
 */
export async function repairSoundPaths(): Promise<{
  moved: number;
  alreadyFine: number;
  projects: number;
  failed: { key: string; reason: string }[];
}> {
  const { readAllProjects, saveProject } = await import("./projects");

  const failed: { key: string; reason: string }[] = [];
  const moved = new Map<string, string>();
  let alreadyFine = 0;

  const index = await readLibrary();
  for (const entry of index.entries) {
    if (!entry.key.startsWith("sfx-")) continue;
    if (entry.url.endsWith(".mp3")) {
      alreadyFine += 1;
      continue;
    }

    try {
      const response = await fetch(entry.url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      const url = await writeBinary(
        libraryPath(entry.key, entry.style, entry.fingerprint, true),
        bytes,
        "audio/mpeg",
      );
      moved.set(entry.url, url);
    } catch (err) {
      failed.push({ key: entry.key, reason: (err as Error).message.slice(0, 120) });
    }
  }

  if (moved.size > 0) {
    await serialise(async () => {
      const current = await readLibrary();
      await writeJson(INDEX, {
        entries: current.entries.map((e) =>
          moved.has(e.url) ? { ...e, url: moved.get(e.url)! } : e,
        ),
        updatedAt: Date.now(),
      } satisfies LibraryIndex);
    }).catch(() => undefined);
  }

  // The projects hold their own copy of every sound URL, and a project still
  // pointing at the old name would render silent however tidy the index is.
  let projects = 0;
  for (const record of await readAllProjects()) {
    const video = record.project as unknown as {
      kind?: string;
      sounds?: { url?: string }[];
    };
    if (video.kind !== "video" || !video.sounds?.length) continue;

    let touched = false;
    for (const sound of video.sounds) {
      const next = sound.url ? moved.get(sound.url) : undefined;
      if (next) {
        sound.url = next;
        touched = true;
      }
    }
    if (!touched) continue;

    await saveProject({ ...record, updatedAt: Date.now() }).catch((err) => {
      failed.push({ key: record.id, reason: (err as Error).message.slice(0, 120) });
    });
    projects += 1;
  }

  return { moved: moved.size, alreadyFine, projects, failed };
}

/**
 * Den mitgemalten Rand aus allen schon gezeichneten Bildern schneiden.
 *
 * Kostet nichts: kein Modell wird gerufen, nichts wird neu gezeichnet. Die
 * Datei wird geholt, gemessen, und nur wenn wirklich ein Rand da ist, unter
 * demselben Pfad zurückgeschrieben. Damit sind auch die Bilder in Ordnung,
 * die entstanden sind, als der Prompt noch „leave a little air on all four
 * sides" sagte — und die sonst nur durch Neuzeichnen zu retten wären.
 *
 * Derselbe Pfad, also dieselbe URL: kein Projekt muss angefasst werden, keine
 * gespeicherte Adresse wird ungültig. Das Vorschaubild wird mitgezogen, sonst
 * zeigt die Liste weiter den Rand.
 */
export async function trimStoredImages(limit = 400): Promise<{
  checked: number;
  trimmed: { key: string; sides: string }[];
  failed: { key: string; reason: string }[];
}> {
  const { deframe } = await import("./deframe");
  const { entries } = await readLibrary();

  const trimmed: { key: string; sides: string }[] = [];
  const failed: { key: string; reason: string }[] = [];
  let checked = 0;

  for (const entry of entries.slice(0, limit)) {
    if (entry.key.startsWith("sfx-")) continue;
    checked += 1;
    try {
      const response = await fetch(entry.url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const before = Buffer.from(await response.arrayBuffer());

      const clean = await deframe(before);
      if (!clean.changed) continue;

      const path = libraryPath(entry.key, entry.style, entry.fingerprint);
      await writeBinary(path, clean.bytes, "image/png");
      await makeThumb(
        thumbPath(entry.key, entry.style, entry.fingerprint),
        clean.bytes,
        "image/png",
      );

      const t = clean.trimmed;
      trimmed.push({
        key: entry.key,
        sides: `oben ${t.top} %, unten ${t.bottom} %, links ${t.left} %, rechts ${t.right} %`,
      });
    } catch (err) {
      // Ein Bild, das sich nicht holen lässt, hält die anderen nicht auf.
      failed.push({ key: entry.key, reason: (err as Error).message.slice(0, 120) });
    }
  }

  return { checked, trimmed, failed };
}
