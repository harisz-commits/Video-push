import { list } from "@vercel/blob";
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
    model: args.model,
    createdAt: Date.now(),
    uses: 1,
  };

  const index = await readLibrary();
  // Replaced rather than appended when it already exists: a redraw of the same
  // subject in the same look is a correction, and keeping both would leave the
  // old one to be found by the next lookup.
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
  } satisfies LibraryIndex).catch(() => undefined);

  return entry;
}

/** Note that a stored picture was used again, for the studio's list. */
export async function noteUse(key: string, style: string): Promise<void> {
  const index = await readLibrary();
  const entry = index.entries.find((e) => e.key === key && e.style === style);
  if (!entry) return;
  entry.uses += 1;
  await writeJson(INDEX, {
    ...index,
    updatedAt: Date.now(),
  } satisfies LibraryIndex).catch(() => undefined);
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

/** A short, stable tag for a style name, so one key can hold several looks. */
function hash(style: string): string {
  let h = 2166136261;
  for (let i = 0; i < style.length; i++) {
    h ^= style.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36).slice(0, 6);
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
