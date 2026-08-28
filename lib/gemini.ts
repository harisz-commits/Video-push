/**
 * Image generation for the studio: thumbnails, and the pictures a video is
 * made of.
 *
 * It was written for thumbnails alone, and the video format later helped
 * itself to it — which is how every video picture came to carry a thumbnail's
 * instructions. See PHOTO_STYLE.
 *
 * The reasoning that kept image models out of the videos does not apply here.
 * There it would have been forty images per film, each replacing a layer of
 * vector animation with a flat picture that cannot move. A thumbnail is one
 * image, it is supposed to be flat, and it is the single frame that decides
 * whether anybody clicks — the best possible place to spend four cents.
 *
 * What is NOT asked of it: text. Image models still mangle German words, and a
 * thumbnail whose headline reads "ERRAETN" is worse than no thumbnail. The
 * picture is a background; every word on top of it is drawn on the canvas.
 */

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

/**
 * The catalogue lives in its own module so the studio can draw the list of
 * models, and their prices, without pulling this generator into the browser.
 */
export {
  IMAGE_MODELS,
  DEFAULT_MODEL,
  resolveModel,
  type ImageModel,
} from "./image-models";

import { DEFAULT_MODEL, type ImageModel } from "./image-models";

export class GeminiError extends Error {
  // A plain field rather than a constructor parameter property, so this module
  // runs under `node --experimental-strip-types` and its request shape can be
  // tested against a stubbed fetch without a build step or an API key.
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "GeminiError";
    this.status = status;
  }
}

/**
 * The style a THUMBNAIL image is asked for. Only a thumbnail.
 *
 * Written as instructions about the *photograph* rather than about the design:
 * asked for a "thumbnail", the model draws its idea of one — complete with
 * invented text, arrows and borders that then fight with the real ones.
 *
 * It used to be appended to every request this module made, including the
 * seventy-five pictures of a video — so each of those was ordered as an
 * illustration and as a photograph in the same breath: "never photographic"
 * from the film's own style text, "Photorealistic, studio lighting, shot on a
 * wide lens" from here. They came out as illustrations mostly because the
 * film's half is longer and more insistent, and occasionally they did not.
 * One picture in a fourteen-picture Egypt film came back a photograph, and the
 * cause was assumed to be the subject; it was this.
 *
 * A video brings its own complete style. It gets nothing from here.
 */
const PHOTO_STYLE = [
  "Photorealistic, bright, high contrast, vivid saturated colours.",
  "Simple clear subject, uncluttered composition.",
  "Studio lighting, sharp focus, shot on a wide lens.",
  // Without this the model returns a cut-out object floating on white, which
  // is a fine product shot and a bad background: on the split layout it puts a
  // blank white panel next to the coloured half and the thumbnail reads as
  // unfinished. This is a background, and a background has to reach the edges.
  "This is a full-bleed background image: the scene fills the entire frame edge to edge, with a rich coloured or textured environment behind the subject. Never an isolated object on a plain white or empty studio backdrop.",
  "Absolutely no text, no letters, no numbers, no watermarks, no logos, no borders, no user interface elements.",
].join(" ");

/**
 * Where the picture ends up, which decides where the room has to be.
 *
 * The canvas crops to fill, so a subject dead centre survives one layout and
 * gets its head cut off in another. Asking for the right framing up front is
 * free; re-generating because the crop ate the subject is not.
 */
const FRAMING: Record<string, string> = {
  full: "The image fills a 16:9 frame and text will be placed over its left third — keep that left third calm and empty, and put the subject right of centre.",
  split:
    "The image will be cropped to a roughly square area, so keep the subject centred and well inside the frame; the left and right edges will be cut away.",
  bottom:
    "The image will be cropped to a wide, short letterbox strip, so keep the subject centred vertically and do not rely on the top or bottom of the frame.",
  /*
   * The video format, which is the only caller that puts nothing on top of the
   * picture at all — no headline, no answer boxes. What it does do is move
   * slowly across the still while it is on screen, so the composition has to
   * survive being seen at a slight offset in any direction.
   */
  /*
   * "Leave a little air on all four sides" stand hier einmal und war der
   * Grund, warum ein Teil der Bilder wie ein aufgeklebtes Blatt aussah: als
   * Kompositionshinweis gemeint, von einem Bildmodell als Passepartout
   * gelesen. Die Fassung darunter sagt beides getrennt — die Zeichnung geht
   * bis an die Kante, das Motiv sitzt trotzdem nicht in der äußersten Ecke.
   */
  story:
    "The illustration MUST fill the entire 16:9 canvas and bleed off all four edges. " +
    "Absolutely no border, no margin, no matte, no passe-partout, no frame or frame line, " +
    "no white or cream surround, no paper edge, no drop shadow, no vignette, no rounded corners: " +
    "the drawing is the whole canvas, not a picture placed on a background. " +
    "Do not render it as a card, a poster, a sticker, a page in a book, or a floating panel. " +
    "The scenery continues past every edge and is simply cut off there. " +
    "Nothing is placed over the image. It will drift and zoom slowly by a few percent while on " +
    "screen, so keep the main subject clear of the outermost tenth of the frame — but fill that " +
    "tenth with more of the same scenery, never with empty space. " +
    // Der zweite Weg zum aufgeklebten Blatt, und er kommt nicht vom Rand,
    // sondern vom Bildaufbau: bittet man um einen Querschnitt oder einen
    // Bodenaufbau, malt das Modell gern einen isometrischen Block, der auf
    // einer leeren Fläche steht. Der Rand ist dann sauber und das Bild
    // trotzdem eine Illustration auf Papier. Also wird die Darstellungsform
    // ausgeschlossen und die Alternative gleich mitgesagt.
    "NEVER draw the scene as an isometric block, a cut-away cube, a slab, a diorama on a plinth, " +
    "a 3D chunk of terrain with visible side walls, a specimen on a stand, or any object sitting " +
    "on an empty surface. For a cross-section or a view of underground layers, cut straight " +
    "THROUGH the world so that the section itself fills the frame edge to edge — the viewer is " +
    "inside the cut, not looking at a model of it on a table. No visible corners, no perspective " +
    "side faces, no baseplate, no shadow under the scene.",
};

/**
 * The shape to ask the model for, so less of the picture is thrown away.
 *
 * The canvas crops to fill. A square picture in the wide bottom strip loses
 * two thirds of its height — paid for, generated, discarded. Asking for the
 * right shape costs the same as asking for the wrong one.
 *
 * 21:9 rather than the strip's true 3.2:1 because 21:9 is the widest the API
 * offers; the rest is trimmed off the sides, where nothing important is.
 */
const ASPECT: Record<string, string> = {
  full: "16:9",
  split: "1:1",
  bottom: "21:9",
  story: "16:9",
};

export async function generateImage({
  prompt,
  apiKey,
  layout,
  model,
  signal,
}: {
  prompt: string;
  apiKey: string;
  layout?: string;
  model?: ImageModel;
  signal?: AbortSignal;
}): Promise<{ data: Buffer; mimeType: string; model: string }> {
  const chosen = model ?? DEFAULT_MODEL;

  // Every spelling of this model's id, newest first. A 404 costs nothing, so
  // trying the next one is free; running out of them is a real error.
  const ids = [chosen.id, ...(chosen.alt ?? [])];
  let lastError: GeminiError | null = null;

  for (const id of ids) {
    try {
      return { ...(await draw(id)), model: id };
    } catch (err) {
      const unknownModel =
        err instanceof GeminiError &&
        (err.status === 404 || /not found|not supported/i.test(err.message));
      if (!unknownModel) throw err;
      lastError = err as GeminiError;
    }
  }

  throw (
    lastError ??
    new GeminiError(`Kein Modell unter ${ids.join(", ")} erreichbar.`, 404)
  );

  async function draw(
    modelId: string,
  ): Promise<{ data: Buffer; mimeType: string }> {
    const framing = (layout && FRAMING[layout]) ?? FRAMING.split;
    const aspectRatio = (layout && ASPECT[layout]) ?? ASPECT.split;
    // The video format states its own look in full and would only be
    // contradicted by a second one. Everything else is a thumbnail.
    const house = layout === "story" ? "" : PHOTO_STYLE;

    const ask = (options: { withAspect: boolean; withText: boolean }) =>
      fetch(`${ENDPOINT}/${encodeURIComponent(modelId)}:generateContent`, {
        method: "POST",
        headers: {
          "x-goog-api-key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: `${prompt}\n\n${[house, framing].filter(Boolean).join(" ")}`,
                },
              ],
            },
          ],
          generationConfig: {
            // Some models in this family will not emit an image unless they are
            // also allowed to talk. Asked for IMAGE alone they answer with an
            // empty candidate and finishReason NO_IMAGE — a 200 with nothing in
            // it, which reads like a bug in this code and is not one.
            responseModalities: options.withText
              ? ["TEXT", "IMAGE"]
              : ["IMAGE"],
            ...(options.withAspect ? { imageConfig: { aspectRatio } } : {}),
          },
        }),
        signal,
      });

    let withAspect = true;

    // Aspect ratios arrived after the image models did, and an older or
    // differently-named model rejects the whole request over the unknown field.
    // A rejected request costs nothing, so the fallback is simply to ask again
    // without it and let the prompt do the framing — which is what it did
    // before this existed. Every other error is passed straight through.
    let response = await ask({ withAspect, withText: false });
    if (response.status === 400) {
      const complaint = await response
        .clone()
        .text()
        .catch(() => "");
      if (/imageConfig|aspect/i.test(complaint)) {
        withAspect = false;
        response = await ask({ withAspect, withText: false });
      }
    }

    let body = await parse(response);

    // Nothing drawn, nothing refused: ask once more with text allowed. Once,
    // deliberately — a loop here is a loop that spends money.
    //
    // Only on a response that succeeded. A rejected key produces no image part
    // either, and asking the same rejected key a second time is a wasted call
    // whose answer is already known.
    if (response.ok && !body.blocked && !imagePart(body.json)) {
      response = await ask({ withAspect, withText: true });
      body = await parse(response);
    }

    if (!response.ok) {
      // The body carries the actual complaint — a wrong model name, a key
      // without the API enabled, a quota. Reporting only the status number sent
      // a day into the wrong place once already.
      //
      // The model name belongs in the message too: the most likely reason a
      // first attempt fails is a model id that has been renamed or retired, and
      // "Gemini antwortete mit 404" alone does not point at it.
      throw new GeminiError(
        `Gemini (${modelId}) antwortete mit ${response.status}. ${summarize(body.raw)}`,
        response.status,
      );
    }

    if (body.blocked) {
      throw new GeminiError(
        `Gemini hat den Bildwunsch abgelehnt (${body.blocked}). Formuliere ihn anders.`,
        400,
      );
    }

    const part = imagePart(body.json);

    if (!part?.inlineData?.data) {
      const reason = body.json?.candidates?.[0]?.finishReason;
      // When a model declines to draw something it usually says why in a text
      // part, and that sentence is the entire diagnosis. Throwing only
      // "kein Bild (NO_IMAGE)" hides the one useful thing in the response.
      const said = spoken(body.json);
      throw new GeminiError(
        `Gemini hat kein Bild zurückgegeben${reason ? ` (${reason})` : ""}.${
          said ? ` Das Modell sagt: „${said}"` : ""
        }`,
        502,
      );
    }

    return {
      data: Buffer.from(part.inlineData.data, "base64"),
      mimeType: part.inlineData.mimeType ?? "image/png",
    };
  }
}

type GeminiBody = {
  candidates?: {
    content?: {
      parts?: {
        text?: string;
        inlineData?: { data?: string; mimeType?: string };
      }[];
    };
    finishReason?: string;
  }[];
  promptFeedback?: { blockReason?: string };
};

/** The response, kept both parsed and raw — errors need the raw text. */
async function parse(response: Response): Promise<{
  json: GeminiBody | null;
  raw: string;
  blocked?: string;
}> {
  const raw = await response.text().catch(() => "");
  let json: GeminiBody | null = null;
  try {
    json = JSON.parse(raw) as GeminiBody;
  } catch {
    // A non-JSON body is a gateway or proxy talking, not the API.
  }
  return { json, raw, blocked: json?.promptFeedback?.blockReason };
}

function imagePart(body: GeminiBody | null) {
  return body?.candidates
    ?.flatMap((c) => c.content?.parts ?? [])
    .find((p) => p.inlineData?.data);
}

/** Whatever the model wrote instead of drawing. */
function spoken(body: GeminiBody | null): string {
  return (body?.candidates ?? [])
    .flatMap((c) => c.content?.parts ?? [])
    .map((p) => p.text)
    .filter((t): t is string => Boolean(t))
    .join(" ")
    .trim()
    .slice(0, 220);
}

/** Pull the message out of Google's error envelope, or fall back to raw text. */
function summarize(detail: string): string {
  try {
    const parsed = JSON.parse(detail) as { error?: { message?: string } };
    if (parsed.error?.message) return parsed.error.message.slice(0, 300);
  } catch {
    // Not JSON; the raw body is the next best thing.
  }
  return detail.slice(0, 300);
}
