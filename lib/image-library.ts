import { del, list } from "@vercel/blob";
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
  const url = await writeBinary(
    // The fingerprint is part of the filename as well as the index, so a
    // redraw under an edited style writes a new file instead of overwriting
    // the picture that other, older projects are still pointing at.
    `${IMAGE_PREFIX}${args.key}-${hash(args.style + (args.fingerprint ?? ""))}.png`,
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
      `${THUMB_PREFIX}${args.key}-${hash(args.style + (args.fingerprint ?? ""))}.webp`,
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
