import { readJson, writeJson } from "./store";
import { StoryStyle } from "./story";

/**
 * Looks worth keeping, by name.
 *
 * The point is not convenience. A channel that decides its style afresh from
 * the topic every time produces twenty videos that look like twenty channels —
 * and the picture library, which only ever returns a picture drawn in the same
 * look, can never hit across them. Saving a look is therefore what turns a
 * video generator into a series: the second Ice Age film reuses the first
 * one's drawings because it is genuinely the same film's style, not merely a
 * similar one.
 *
 * Stored as one small JSON document, like the picture library — there are
 * dozens of these at most, and a listing of the blob store would give
 * filenames where what is wanted is the directive itself.
 */

const INDEX = "library/looks.json";

export type Look = {
  id: string;
  /** What the person calls it. Defaults to the style's own name. */
  label: string;
  style: StoryStyle;
  createdAt: number;
  /** How often a film has been started from it. */
  uses: number;
};

export type LookIndex = { looks: Look[]; updatedAt: number };

export async function readLooks(): Promise<LookIndex> {
  const index = await readJson<LookIndex>(INDEX).catch(() => null);
  return index && Array.isArray(index.looks) ? index : { looks: [], updatedAt: 0 };
}

/**
 * Keep a look, or replace the one already under this id.
 *
 * Replacing rather than appending is deliberate: editing a saved look and
 * saving it again is a correction, and two entries with the same name would
 * leave the older one to be picked by mistake for as long as it existed.
 */
export async function saveLook(args: {
  id?: string;
  label: string;
  style: StoryStyle;
}): Promise<Look> {
  const index = await readLooks();
  const existing = args.id
    ? index.looks.find((l) => l.id === args.id)
    : undefined;

  const look: Look = {
    id: existing?.id ?? `look-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    label: args.label.trim().slice(0, 80) || args.style.name,
    style: args.style,
    createdAt: existing?.createdAt ?? Date.now(),
    uses: existing?.uses ?? 0,
  };

  await writeJson(INDEX, {
    looks: [look, ...index.looks.filter((l) => l.id !== look.id)].slice(0, 200),
    updatedAt: Date.now(),
  } satisfies LookIndex);

  return look;
}

export async function deleteLook(id: string): Promise<void> {
  const index = await readLooks();
  await writeJson(INDEX, {
    looks: index.looks.filter((l) => l.id !== id),
    updatedAt: Date.now(),
  } satisfies LookIndex);
}

/** Note that a film was started from a saved look. Best effort. */
export async function noteLookUse(id: string): Promise<void> {
  const index = await readLooks();
  const look = index.looks.find((l) => l.id === id);
  if (!look) return;
  look.uses += 1;
  await writeJson(INDEX, { ...index, updatedAt: Date.now() } satisfies LookIndex).catch(
    () => undefined,
  );
}
