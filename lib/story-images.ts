import { deframe } from "./deframe";
import { generateImage } from "./gemini";
import { resolveModel, type ImageModel } from "./image-models";
import { findStored, lookup, noteUse, remember } from "./image-library";
import { imagePrompt, portraitPrompt } from "./story-prompt";
import {
  styleFingerprint,
  type StoryCharacter,
  type StoryProject,
} from "./story";

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
  /** Figurenporträts, die neu gezeichnet werden mussten. In `drawn` enthalten. */
  portraits: number;
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

  /**
   * Das Figurenblatt: ein Porträt je Figur, bevor irgendetwas anderes
   * gezeichnet wird.
   *
   * Vorher und nicht nebenbei, weil die Bilder in drei Bahnen gleichzeitig
   * entstehen. Liesse man die Vorlage beim ersten Bild mit der Figur
   * entstehen, entschiede der Zufall, welches Bild zuerst fertig ist — und
   * damit, wie die Figur für den Rest des Films aussieht.
   *
   * Das Porträt liegt in der Bibliothek wie jedes andere Bild und wird beim
   * nächsten Video mit demselben Look wiedergefunden. Eine Figur kostet also
   * einmal 3,4 Cent und danach nichts mehr.
   */
  const portraits = new Map<string, { data: Buffer; mimeType: string }>();
  const drawnPortraits = new Map<string, string>();
  let paidPortraits = 0;

  /** Die Vorlage einer Figur als Bytes, einmal geholt und dann gemerkt. */
  const referenceFor = async (
    figures: StoryCharacter[],
  ): Promise<{ data: Buffer; mimeType: string }[]> => {
    const out: { data: Buffer; mimeType: string }[] = [];
    for (const figure of figures) {
      const cached = portraits.get(figure.key);
      if (cached) {
        out.push(cached);
        continue;
      }
      const url = drawnPortraits.get(figure.key) ?? figure.refUrl;
      if (!url) continue;
      try {
        const res = await fetch(url);
        if (!res.ok) continue;
        const loaded = {
          data: Buffer.from(await res.arrayBuffer()),
          mimeType: res.headers.get("content-type") ?? "image/png",
        };
        portraits.set(figure.key, loaded);
        out.push(loaded);
      } catch {
        // Eine Vorlage, die sich nicht laden lässt, ist kein Grund, das Bild
        // nicht zu zeichnen. Ohne sie wird wie vor dieser Erweiterung nur aus
        // der Beschreibung gezeichnet.
      }
    }
    return out;
  };

  // Nur Figuren, die in den zu zeichnenden Bildern wirklich vorkommen: eine
  // Figur, die im Skript steht und in keinem Bild, braucht kein Porträt.
  const needed = new Set(wanted.flatMap((i) => i.characters ?? []));
  for (const figure of args.project.characters ?? []) {
    if (!needed.has(figure.key) || figure.refUrl) continue;
    if (args.deadline && Date.now() > args.deadline) break;

    const key = `figur-${figure.key}`;
    const fingerprint = styleFingerprint(style, [figure]);
    try {
      const known =
        (await lookup(key, style.name, fingerprint).catch(() => null)) ??
        (await findStored({
          key,
          name: figure.name,
          prompt: figure.appearance ?? figure.description,
          style: style.name,
          fingerprint,
        }).catch(() => null));

      if (known) {
        drawnPortraits.set(figure.key, known.url);
        await noteUse(key, style.name).catch(() => undefined);
        continue;
      }

      const result = await generateImage({
        prompt: portraitPrompt(figure, style),
        apiKey: args.apiKey,
        layout: "story",
        // Das Blatt ist eine Nahaufnahme, und die Kamera fährt darüber nie —
        // es wird nie gezeigt, sondern nur mitgeschickt.
        size: "close",
        model,
      });
      const clean = await deframe(result.data);
      const entry = await remember({
        key,
        name: `Figur: ${figure.name}`,
        prompt: figure.appearance ?? figure.description,
        style: style.name,
        fingerprint,
        model: result.model,
        bytes: clean.bytes,
        contentType: result.mimeType,
      });
      drawnPortraits.set(figure.key, entry.url);
      portraits.set(figure.key, {
        data: clean.bytes,
        mimeType: result.mimeType,
      });
      paid += 1;
      paidPortraits += 1;
    } catch {
      // Ohne Porträt wird die Figur wie bisher aus der Beschreibung gezeichnet.
      // Schlechter, aber kein Grund, das ganze Video anzuhalten.
    }
  }

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
          size: image.shot,
          references: await referenceFor(figures),
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
      characters: (args.project.characters ?? []).map((figure) => {
        const url = drawnPortraits.get(figure.key);
        return url ? { ...figure, refUrl: url } : figure;
      }),
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
    portraits: paidPortraits,
  };
}

/**
 * What drawing this project would cost right now, before anything is spent.
 *
 * Die Figurenporträts zählen mit. Sie sind Bilder wie alle anderen, werden
 * bezahlt wie alle anderen, und ein Preis am Knopf, der sie unterschlägt,
 * wäre genau die Art Überraschung, die dieses Studio nicht machen soll.
 *
 * Gezählt werden nur Figuren, die in einem noch ungezeichneten Bild wirklich
 * vorkommen und noch kein Porträt haben — eine Figur aus einem früheren Video
 * mit demselben Look kostet nichts mehr.
 */
export function drawCostCents(
  project: StoryProject,
  model?: ImageModel,
  /** Nur so viele Bilder, wie die Vorschau zeichnet. */
  limit?: number,
): { images: number; portraits: number; cents: number } {
  const chosen = model ?? resolveModel();
  const undrawn = project.images
    .filter((i) => !i.url)
    .slice(0, limit ?? undefined);

  const needed = new Set(undrawn.flatMap((i) => i.characters ?? []));
  const portraits = (project.characters ?? []).filter(
    (c) => needed.has(c.key) && !c.refUrl,
  ).length;

  return {
    images: undrawn.length,
    portraits,
    cents: Number(((undrawn.length + portraits) * chosen.cents).toFixed(2)),
  };
}
