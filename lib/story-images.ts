import { deframe } from "./deframe";
import { generateImage } from "./gemini";
import { resolveModel, type ImageModel } from "./image-models";
import { findStored, lookup, noteUse, remember } from "./image-library";
import { imagePrompt } from "./story-prompt";
import { styleFingerprint, type StoryCharacter, type StoryProject } from "./story";

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
  /** Bilder, denen ein mitgemalter Rand abgeschnitten wurde. */
  trimmed: number;
};

export async function drawStoryImages(args: {
  project: StoryProject;
  apiKey: string;
  model?: ImageModel;
  /** Stop starting new pictures after this epoch time. */
  deadline?: number;
  /**
   * Nur so viele zeichnen — für die Vorschau.
   *
   * Ein Bildstil entscheidet sich am ersten Bild, nicht am hundertsten. Zwei
   * Bilder kosten sieben Cent und beantworten die Frage, ob der Stil passt;
   * hundert kosten vier Euro und beantworten dieselbe Frage.
   */
  limit?: number;
  onProgress?: (done: number, total: number) => Promise<void>;
}): Promise<DrawResult> {
  const model = args.model ?? resolveModel();
  const style = args.project.style;
  const cast = new Map(
    (args.project.characters ?? []).map((c) => [c.key, c] as const),
  );

  /** The figures actually visible in one picture, in a stable order. */
  const castFor = (keys: string[] | undefined): StoryCharacter[] =>
    (keys ?? [])
      .map((k) => cast.get(k))
      .filter((c): c is StoryCharacter => Boolean(c));

  // Only what is still missing. Re-running after a partial failure therefore
  // costs the remainder rather than the whole film — which matters when the
  // whole film is three dollars.
  const wanted = args.project.images
    .filter((i) => !i.url)
    // Die ersten, nicht irgendwelche: sie stehen am Anfang des Films, und
    // wenn der Stil dort nicht passt, passt er nirgends.
    .slice(0, args.limit ?? undefined);

  const drawn = new Map<
    string,
    { url: string; thumbUrl?: string; model: string; reused: boolean }
  >();
  let paid = 0;
  let reused = 0;
  let trimmedBorders = 0;
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
      const figures = castFor(image.characters);
      const fingerprint = styleFingerprint(style, figures);

      let known = await lookup(image.key, style.name, fingerprint).catch(
        () => null,
      );

      // The index missed - so ask storage directly, before paying.
      //
      // Blob paths here are deterministic, so a picture already drawn for this
      // subject in this look occupies a path this can compute and check. That
      // matters because the index turned out to be the part that fails: a film
      // that paid for seventy-five pictures had four of them recorded, while
      // all seventy-five files were sitting there untouched. A picture that
      // exists must never be bought twice, and the file is the better witness.
      //
      // Two head requests at worst, which is 0.00008 cents against 3.4 for
      // drawing it again.
      if (!known) {
        known = await findStored({
          key: image.key,
          name: image.name,
          prompt: image.prompt,
          style: style.name,
          fingerprint,
        }).catch(() => null);
      }

      if (known) {
        drawn.set(image.key, {
          url: known.url,
          thumbUrl: known.thumbUrl,
          model: known.model,
          reused: true,
        });
        reused += 1;
        await noteUse(image.key, style.name).catch(() => undefined);
        await args.onProgress?.(drawn.size, wanted.length);
        continue;
      }

      try {
        const result = await generateImage({
          prompt: imagePrompt(image.prompt, style, figures),
          apiKey: args.apiKey,
          // "story", not "wide": an unknown layout falls back to the split
          // one, which asks for a square and warns that the sides will be cut
          // away. Every picture in this film came back 1024x1024 and then lost
          // a third of itself to the 16:9 frame — paid for, generated,
          // discarded. See FRAMING and ASPECT in lib/gemini.ts.
          layout: "story",
          model,
        });

        // Der Passepartout-Rand, den das Modell manchmal mitmalt, fällt hier
        // weg und nicht erst beim Rendern: was in der Bibliothek liegt, soll
        // schon in Ordnung sein — sonst müsste jedes spätere Video denselben
        // Rand noch einmal wegrechnen. Siehe lib/deframe.ts.
        const clean = await deframe(result.data);
        if (clean.changed) trimmedBorders += 1;

        const entry = await remember({
          key: image.key,
          name: image.name,
          prompt: image.prompt,
          style: style.name,
          fingerprint,
          model: result.model,
          bytes: clean.bytes,
          contentType: result.mimeType,
        });

        drawn.set(image.key, {
          url: entry.url,
          thumbUrl: entry.thumbUrl,
          model: result.model,
          reused: false,
        });
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
          ? {
              ...image,
              url: hit.url,
              thumbUrl: hit.thumbUrl,
              model: hit.model,
              reused: hit.reused,
            }
          : image;
      }),
    },
    drawn: paid,
    reused,
    cents: Number((paid * model.cents).toFixed(2)),
    failed,
    skipped,
    trimmed: trimmedBorders,
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
