/**
 * Image generation, for thumbnails only.
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
 * Overridable, because model names move and a wrong one should be one env var
 * away from fixed rather than one deployment.
 *
 * The default is the cheapest image model Google sells: about 3.9 cents a
 * picture, no free tier on any of them. The newer Nano-Banana-2 family costs
 * the same to a few cents more and can be switched to with GEMINI_IMAGE_MODEL
 * alone — gemini-3.1-flash-lite-image, gemini-3.1-flash-image,
 * gemini-3-pro-image — without touching this file.
 */
export const MODEL = process.env.GEMINI_IMAGE_MODEL ?? "gemini-2.5-flash-image";

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
 * The style every thumbnail image is asked for.
 *
 * Written as instructions about the *photograph* rather than about the design:
 * asked for a "thumbnail", the model draws its idea of one — complete with
 * invented text, arrows and borders that then fight with the real ones.
 */
const STYLE = [
  "Photorealistic, bright, high contrast, vivid saturated colours.",
  "Simple clear subject, uncluttered composition.",
  "Studio lighting, sharp focus, shot on a wide lens.",
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
};

export async function generateImage({
  prompt,
  apiKey,
  layout,
  signal,
}: {
  prompt: string;
  apiKey: string;
  layout?: string;
  signal?: AbortSignal;
}): Promise<{ data: Buffer; mimeType: string }> {
  const framing = (layout && FRAMING[layout]) ?? FRAMING.split;
  const aspectRatio = (layout && ASPECT[layout]) ?? ASPECT.split;

  const ask = (options: { withAspect: boolean; withText: boolean }) =>
    fetch(`${ENDPOINT}/${encodeURIComponent(MODEL)}:generateContent`, {
      method: "POST",
      headers: {
        "x-goog-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `${prompt}\n\n${STYLE} ${framing}` }] }],
        generationConfig: {
          // Some models in this family will not emit an image unless they are
          // also allowed to talk. Asked for IMAGE alone they answer with an
          // empty candidate and finishReason NO_IMAGE — a 200 with nothing in
          // it, which reads like a bug in this code and is not one.
          responseModalities: options.withText ? ["TEXT", "IMAGE"] : ["IMAGE"],
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
    const complaint = await response.clone().text().catch(() => "");
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
      `Gemini (${MODEL}) antwortete mit ${response.status}. ${summarize(body.raw)}`,
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
