import { z } from "zod";

/**
 * Everything about a thumbnail that is worth keeping.
 *
 * Stored on the project rather than in the browser, because one part of it
 * costs money: a generated background is a few cents and ten seconds, and
 * losing it to a page reload would mean paying for the same picture twice.
 * The rest — words, colours, layout — rides along because a thumbnail someone
 * spent five minutes arranging should still be arranged tomorrow.
 */
export const ThumbnailConfig = z.object({
  /** The headline, one line per newline. */
  lines: z.string().max(400).optional(),
  /** Index into the palette list in the panel. */
  skin: z.number().int().min(0).max(9).optional(),
  /** Which line carries the highlighter bar; -1 for none. */
  marked: z.number().int().min(-1).max(3).optional(),
  layout: z.enum(["split", "full", "bottom"]).optional(),
  /** The hand-drawn arrow pointing at the subject. */
  arrow: z.boolean().optional(),
  /** A heavy outline behind the letters, for text over a photograph. */
  outline: z.boolean().optional(),
  /** A generated background. Absent means the flat colour is the background. */
  imageUrl: z.string().url().optional(),
  /** What was asked for, so it can be adjusted rather than rewritten. */
  imagePrompt: z.string().max(600).optional(),
  /**
   * Which image model to use. See IMAGE_MODELS in lib/gemini.ts.
   *
   * A plain string rather than an enum: the list of models changes faster than
   * saved projects do, and an id that has since been retired should cost a
   * different picture, not make an old project fail to load.
   */
  model: z.string().max(64).optional(),
});
export type ThumbnailConfig = z.infer<typeof ThumbnailConfig>;
