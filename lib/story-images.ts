import { generateImage } from "./gemini";
import { resolveModel, type ImageModel } from "./image-models";
import { lookup, noteUse, remember } from "./image-library";
import { imagePrompt } from "./story-prompt";
import type { StoryProject } from "./story";

/**
 * Drawing the pictures.
 *
 * Its own step, and its own button, because this is the expensive half: a
 * script costs a fraction of a cent and a hundred pictures cost three dollars.
 * Nothing here runs until somebody has read the script and decided it is worth
 * illustrating.
 *
 * Two things keep the bill down. The library is asked first, and a picture
 * already drawn for this subject in this look costs nothing at all. And the
 * project stores pictures per subject rather than per shot, so a motif that
 * comes back three times in the film is paid for once.
 */

/**
 * How many pictures are drawn at once.
 *
 * Three, not one, because a hundred sequential requests would outlast the
 * function making them; and three, not twenty, because Gemini's image endpoint
 * rate-limits, and a refusal here costs a picture rather than delaying one.
 */
const LANES = 3;

export type DrawResult = {
  project: StoryProject;
  /** Pictures actually paid for. */
  drawn: number;
  /** Pictures that came out of the library for free. */
  reused: number;
  /** What the paid ones cost, in US cents. */
  cents: number;
  /** Pictures that could not be drawn at all, with the reason. */
  failed: { key: string; reason: string }[];
  /** Pictures not attempted because the clock ran out. */
  skipped: number;
};

export async function drawStoryImages(args: {
  project: StoryProject;
  apiKey: string;
  model?: ImageModel;
  /** Stop starting new pictures after this epoch time. */
  deadline?: number;
  onProgress?: (done: number, total: number) => Promise<void>;
}): Promise<DrawResult> {
  const model = args.model ?? resolveModel();
  const style = args.project.style;

  // Only what is still missing. Re-running after a partial failure therefore
  // costs the remainder rather than the whole film — which matters when the
  // whole film is three dollars.
  const wanted = args.project.images.filter((i) => !i.url);

  const drawn = new Map<string, { url: string; model: string; reused: boolean }>();
  let paid = 0;
  let reused = 0;
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

      const image = wanted[index];

      // The library first. Matched on subject AND look — the same house drawn
      // in a cold blue style is the wrong picture for a sand-coloured film,
      // and putting it in would produce exactly the mismatch this format
      // exists to avoid.
      const known = await lookup(image.key, style.name).catch(() => null);
      if (known) {
        drawn.set(image.key, { url: known.url, model: known.model, reused: true });
        reused += 1;
        await noteUse(image.key, style.name).catch(() => undefined);
        await args.onProgress?.(drawn.size, wanted.length);
        continue;
      }

      try {
        const result = await generateImage({
          prompt: imagePrompt(image.prompt, style),
          apiKey: args.apiKey,
          layout: "wide",
          model,
        });

        const entry = await remember({
          key: image.key,
          name: image.name,
          prompt: image.prompt,
          style: style.name,
          model: result.model,
          bytes: result.data,
          contentType: result.mimeType,
        });

        drawn.set(image.key, { url: entry.url, model: result.model, reused: false });
        paid += 1;
      } catch (err) {
        // One picture that will not draw must not cost the other ninety-nine.
        // The shot keeps its key and simply has no url; the composition holds
        // the previous picture instead of showing a hole.
        failed.push({
          key: image.key,
          reason: (err as Error).message.slice(0, 160),
        });
      }

      await args.onProgress?.(drawn.size + failed.length, wanted.length);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(LANES, wanted.length) }, lane),
  );

  return {
    project: {
      ...args.project,
      images: args.project.images.map((image) => {
        const hit = drawn.get(image.key);
        return hit
          ? { ...image, url: hit.url, model: hit.model, reused: hit.reused }
          : image;
      }),
    },
    drawn: paid,
    reused,
    cents: Number((paid * model.cents).toFixed(2)),
    failed,
    skipped,
  };
}

/** What drawing this project would cost right now, before anything is spent. */
export function drawCostCents(
  project: StoryProject,
  model?: ImageModel,
): { images: number; cents: number } {
  const chosen = model ?? resolveModel();
  const images = project.images.filter((i) => !i.url).length;
  return { images, cents: Number((images * chosen.cents).toFixed(2)) };
}
