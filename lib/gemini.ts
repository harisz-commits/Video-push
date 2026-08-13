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

/** Overridable, because model names move and a wrong one should be one env var away from fixed. */
const MODEL = process.env.GEMINI_IMAGE_MODEL ?? "gemini-2.5-flash-image";

export class GeminiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "GeminiError";
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
  const response = await fetch(
    `${ENDPOINT}/${encodeURIComponent(MODEL)}:generateContent`,
    {
      method: "POST",
      headers: {
        "x-goog-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `${prompt}\n\n${STYLE} ${framing}` }] }],
        generationConfig: { responseModalities: ["IMAGE"] },
      }),
      signal,
    },
  );

  if (!response.ok) {
    // The body carries the actual complaint — a wrong model name, a key
    // without the API enabled, a quota. Reporting only the status number sent
    // a day into the wrong place once already.
    const detail = await response.text().catch(() => "");
    throw new GeminiError(
      `Gemini antwortete mit ${response.status}. ${summarize(detail)}`,
      response.status,
    );
  }

  const body = (await response.json()) as {
    candidates?: {
      content?: { parts?: { inlineData?: { data?: string; mimeType?: string } }[] };
      finishReason?: string;
    }[];
    promptFeedback?: { blockReason?: string };
  };

  const blocked = body.promptFeedback?.blockReason;
  if (blocked) {
    throw new GeminiError(
      `Gemini hat den Bildwunsch abgelehnt (${blocked}). Formuliere ihn anders.`,
      400,
    );
  }

  const part = body.candidates
    ?.flatMap((c) => c.content?.parts ?? [])
    .find((p) => p.inlineData?.data);

  if (!part?.inlineData?.data) {
    const reason = body.candidates?.[0]?.finishReason;
    throw new GeminiError(
      `Gemini hat kein Bild zurückgegeben${reason ? ` (${reason})` : ""}.`,
      502,
    );
  }

  return {
    data: Buffer.from(part.inlineData.data, "base64"),
    mimeType: part.inlineData.mimeType ?? "image/png",
  };
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
