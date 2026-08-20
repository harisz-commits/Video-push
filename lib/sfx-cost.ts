import type { StoryProject } from "./story";

/**
 * What the sound design of a film costs, before any of it is generated.
 *
 * Its own module for the same reason lib/image-models.ts is one: the studio
 * shows this number in the browser, and lib/sfx.ts — which generates the
 * sounds — reaches the picture library, which reaches an image encoder. None
 * of that belongs in a browser bundle, and Turbopack traces the whole chain
 * whether or not the browser would ever call it.
 */

/** Characters billed per second, measured against the account's own counter. */
export const CHARS_PER_SECOND = 48;

export function soundCost(project: StoryProject): {
  sounds: number;
  characters: number;
} {
  const missing = project.sounds.filter((s) => !s.url);
  return {
    sounds: missing.length,
    characters: Math.round(
      missing.reduce((sum, s) => sum + s.seconds, 0) * CHARS_PER_SECOND,
    ),
  };
}
