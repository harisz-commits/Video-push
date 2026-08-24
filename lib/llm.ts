import Anthropic from "@anthropic-ai/sdk";
import { resolveTextModel, type TextModel } from "./text-models";

/**
 * One way to ask a model for text, whoever makes the model.
 *
 * The quiz pipeline does the same thing on both providers — hand over a system
 * prompt and a conversation, get JSON back — so it should not have to know
 * which one it is talking to. Everything provider-shaped lives here.
 *
 * What this deliberately does NOT try to be is a general abstraction over two
 * APIs. It covers exactly what writing a quiz needs: a system prompt, a short
 * message list, a token ceiling, and the token counts back so the studio can
 * report what the run actually cost.
 */

export type Turn = { role: "user" | "assistant"; content: string };

export type Completion = {
  text: string;
  usage: { input: number; output: number };
  /** Set when the reply was cut off at the ceiling rather than finished. */
  truncated: boolean;
};

export class LlmError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "LlmError";
    this.status = status;
  }
}

export function keyFor(model: TextModel): string | undefined {
  return model.provider === "google"
    ? process.env.GEMINI_API_KEY
    : process.env.ANTHROPIC_API_KEY;
}

/** The env var a caller has to set for this model, for error messages. */
export function keyNameFor(model: TextModel): string {
  return model.provider === "google" ? "GEMINI_API_KEY" : "ANTHROPIC_API_KEY";
}

/**
 * Ein JSON-Schema, an das sich die Antwort halten MUSS.
 *
 * Beide Anbieter können das erzwingen, und das ist etwas anderes, als um
 * JSON zu bitten: der Dekodierer darf gar kein Zeichen mehr erzeugen, das
 * das Schema verletzt. Ohne das kam aus einem Lauf ein Titel-Array zurück,
 * dessen erster Eintrag kein Anführungszeichen hatte — „Unexpected token
 * 'S'" —, und der ganze Aufruf war verloren.
 *
 * Nur für kleine, feste Formen gedacht. Ein ganzes Skript unter Schema zu
 * stellen wäre ein Schema mit dreißig Feldern, und beide Anbieter werden
 * dabei langsamer und schlechter.
 */
export type JsonSchema = Record<string, unknown>;

export async function complete(args: {
  model: TextModel;
  apiKey: string;
  system: string;
  messages: Turn[];
  maxTokens: number;
  /** Anthropic only; Google has no equivalent knob on this endpoint. */
  effort?: "low" | "medium" | "high";
  /** Erzwungene Antwortform. Siehe JsonSchema. */
  schema?: JsonSchema;
}): Promise<Completion> {
  return args.model.provider === "google" ? google(args) : anthropic(args);
}

async function anthropic(args: {
  model: TextModel;
  apiKey: string;
  system: string;
  messages: Turn[];
  maxTokens: number;
  effort?: "low" | "medium" | "high";
  schema?: JsonSchema;
}): Promise<Completion> {
  const client = new Anthropic({ apiKey: args.apiKey });

  try {
    return await ask(args.schema);
  } catch (err) {
    // Wie bei Google: ein erzwungenes Schema darf den Aufruf nicht kosten.
    // Lehnt ein Modell die Form ab, läuft derselbe Aufruf ohne sie weiter —
    // das ist der Stand von vorher, nicht ein kaputter Knopf.
    if (args.schema && err instanceof Anthropic.BadRequestError) {
      return ask(undefined);
    }
    throw err;
  }

  async function ask(schema: JsonSchema | undefined): Promise<Completion> {
    // Streamed, and not by preference: above roughly twenty thousand max_tokens
    // the SDK refuses a plain request outright, because one that large could in
    // principle run past ten minutes. Nothing here consumes the stream as it
    // arrives — the streaming is what makes the request legal, not what makes it
    // useful.
    const message = await client.messages
      .stream({
        model: args.model.id,
        max_tokens: args.maxTokens,
        // Effort und Format leben beide unter output_config, also einmal
        // zusammengesetzt statt zweimal gesetzt — die zweite Zuweisung hätte
        // die erste stillschweigend verworfen.
        ...(() => {
          const output_config: Record<string, unknown> = {};
          if (args.model.supportsEffort !== false) {
            // Nur wo das Modell es nimmt: Haiku 4.5 lehnt effort mit einem 400
            // ab, statt es zu ignorieren, und war damit gar nicht wählbar.
            output_config.effort = args.effort ?? "medium";
          }
          if (schema) {
            output_config.format = { type: "json_schema", schema };
          }
          return Object.keys(output_config).length ? { output_config } : {};
        })(),
        system: args.system,
        messages: args.messages,
      })
      .finalMessage();

    if (message.stop_reason === "refusal") {
      throw new LlmError(
        "Das Modell hat dieses Thema abgelehnt. Formuliere es anders oder wähle ein anderes.",
        400,
      );
    }

    return {
      text: message.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join(""),
      usage: {
        input: message.usage.input_tokens,
        output: message.usage.output_tokens,
      },
      truncated: message.stop_reason === "max_tokens",
    };
  }
}

const GOOGLE_ENDPOINT =
  "https://generativelanguage.googleapis.com/v1beta/models";

async function google(args: {
  model: TextModel;
  apiKey: string;
  system: string;
  messages: Turn[];
  maxTokens: number;
  schema?: JsonSchema;
}): Promise<Completion> {
  // Every spelling of this model's id, in order. Google both renames models
  // and retires older ones for new accounts — "no longer available to new
  // users" is a 404, not a deprecation warning — so a rejected id falls
  // through to the next rather than becoming a dead entry in a dropdown. A
  // 404 costs nothing; every other status is a real error and stops here.
  const ids = [args.model.id, ...(args.model.alt ?? [])];
  let lastError: LlmError | null = null;

  for (const id of ids) {
    try {
      return await ask(id, args.schema);
    } catch (err) {
      if (!(err instanceof LlmError)) throw err;
      // Ein erzwungenes Schema darf den Aufruf nicht kosten. Lehnt dieses
      // Modell das Feld ab — ältere Gemini-Stände kennen nur den kleineren
      // OpenAPI-Dialekt und antworten mit 400 —, läuft derselbe Aufruf ohne
      // Schema weiter. Das ist der Stand von vorher: das Modell wird um JSON
      // gebeten, statt darauf festgenagelt.
      if (err.status === 400 && args.schema) {
        try {
          return await ask(id, undefined);
        } catch (retry) {
          if (!(retry instanceof LlmError) || retry.status !== 404) throw retry;
          lastError = retry;
          continue;
        }
      }
      if (err.status !== 404) throw err;
      lastError = err;
    }
  }
  throw lastError ?? new LlmError(`Kein Modell unter ${ids.join(", ")}.`, 404);

  async function ask(
    modelId: string,
    schema: JsonSchema | undefined,
  ): Promise<Completion> {
    const response = await fetch(
      `${GOOGLE_ENDPOINT}/${encodeURIComponent(modelId)}:generateContent`,
      {
        method: "POST",
        headers: {
          "x-goog-api-key": args.apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: args.system }] },
          contents: args.messages.map((m) => ({
            // Google calls the assistant "model"; everything else about the
            // conversation shape is the same.
            role: m.role === "assistant" ? "model" : "user",
            parts: [{ text: m.content }],
          })),
          generationConfig: {
            maxOutputTokens: args.maxTokens,
            // Asking for JSON directly rather than hoping for it. The parser
            // tolerates prose around the object either way, but a model that has
            // been told the shape wanders out of it far less often.
            responseMimeType: "application/json",
            // Und wo die Form feststeht, wird sie erzwungen statt erbeten.
            // Das ist der Unterschied zwischen „antworte bitte als JSON" und
            // einem Dekodierer, der kein ungültiges Zeichen mehr erzeugen darf.
            ...(schema ? { responseJsonSchema: schema } : {}),
          },
        }),
      },
    );

    const raw = await response.text().catch(() => "");
    if (!response.ok) {
      throw new LlmError(
        `Google (${modelId}) antwortete mit ${response.status}. ${summarize(raw)}`,
        response.status,
      );
    }

    let body: {
      candidates?: {
        content?: { parts?: { text?: string }[] };
        finishReason?: string;
      }[];
      promptFeedback?: { blockReason?: string };
      usageMetadata?: {
        promptTokenCount?: number;
        candidatesTokenCount?: number;
        thoughtsTokenCount?: number;
      };
    };
    try {
      body = JSON.parse(raw);
    } catch {
      throw new LlmError("Google antwortete nicht mit JSON.", 502);
    }

    if (body.promptFeedback?.blockReason) {
      throw new LlmError(
        `Google hat das Thema abgelehnt (${body.promptFeedback.blockReason}). Formuliere es anders.`,
        400,
      );
    }

    const candidate = body.candidates?.[0];
    const text = (candidate?.content?.parts ?? [])
      .map((p) => p.text)
      .filter((t): t is string => Boolean(t))
      .join("");

    if (!text) {
      throw new LlmError(
        `Google hat keinen Text zurückgegeben${
          candidate?.finishReason ? ` (${candidate.finishReason})` : ""
        }.`,
        502,
      );
    }

    const usage = body.usageMetadata ?? {};
    return {
      text,
      usage: {
        input: usage.promptTokenCount ?? 0,
        // Thinking is billed as output on both sides, so it is counted as
        // output here too — otherwise Google would look cheaper than the invoice.
        output:
          (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0),
      },
      truncated: candidate?.finishReason === "MAX_TOKENS",
    };
  }
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

export { resolveTextModel };
