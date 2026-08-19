import { readJson, writeJson } from "./store";
import { slugify } from "./image-library";

/**
 * Figures worth keeping, by name.
 *
 * What is stored is the description as it was written — "ein Forscher mit
 * rotem Anorak und Klemmbrett" — and never the English appearance the style
 * step derives from it. That derived text belongs to one film's look: the same
 * researcher is a silk-screen silhouette in one video and a watercolour figure
 * in the next, and storing the silk-screen version would carry the wrong film's
 * style into every later one.
 *
 * So reuse means: the same figure, redescribed for whatever this film looks
 * like. Which is the only kind of reuse that works across styles at all.
 */

const INDEX = "library/characters.json";

export type SavedCharacter = {
  key: string;
  /** German label, as the studio shows it. */
  name: string;
  /** What the person wrote. The source of truth. */
  description: string;
  createdAt: number;
  uses: number;
};

export type CharacterIndex = { characters: SavedCharacter[]; updatedAt: number };

export async function readCharacters(): Promise<CharacterIndex> {
  const index = await readJson<CharacterIndex>(INDEX).catch(() => null);
  return index && Array.isArray(index.characters)
    ? index
    : { characters: [], updatedAt: 0 };
}

export async function saveCharacter(args: {
  name: string;
  description: string;
  key?: string;
}): Promise<SavedCharacter> {
  const index = await readCharacters();
  const key = slugify(args.key?.trim() || args.name);
  const existing = index.characters.find((c) => c.key === key);

  const character: SavedCharacter = {
    key,
    name: args.name.trim().slice(0, 80) || key,
    description: args.description.trim().slice(0, 600),
    createdAt: existing?.createdAt ?? Date.now(),
    uses: existing?.uses ?? 0,
  };

  await writeJson(INDEX, {
    characters: [
      character,
      ...index.characters.filter((c) => c.key !== key),
    ].slice(0, 200),
    updatedAt: Date.now(),
  } satisfies CharacterIndex);

  return character;
}

export async function deleteCharacter(key: string): Promise<void> {
  const index = await readCharacters();
  await writeJson(INDEX, {
    characters: index.characters.filter((c) => c.key !== key),
    updatedAt: Date.now(),
  } satisfies CharacterIndex);
}

/** Note that a film used one. Best effort — nothing depends on the count. */
export async function noteCharacterUse(keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  const index = await readCharacters();
  let touched = false;
  for (const character of index.characters) {
    if (keys.includes(character.key)) {
      character.uses += 1;
      touched = true;
    }
  }
  if (!touched) return;
  await writeJson(INDEX, {
    ...index,
    updatedAt: Date.now(),
  } satisfies CharacterIndex).catch(() => undefined);
}
