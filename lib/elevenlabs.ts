import { resolveSpeechModel } from "./speech-models";
import type { Alignment } from "./schema";

const API_BASE = "https://api.elevenlabs.io/v1";

/**
 * The per-request character ceiling now belongs to the model, not to this
 * file.
 *
 * It used to be one constant here, 9,500, which was right for
 * eleven_multilingual_v2 and wrong for everything else: Flash v2.5 takes
 * 40,000 characters, so a whole twenty-five minute narration fits in one
 * request instead of four. Splitting a script that did not need splitting is
 * not merely wasteful — every seam is a place the recording can drift, and
 * each chunk's offset has to be measured from the MP3 rather than known.
 *
 * See lib/speech-models.ts.
 */
export const DEFAULT_MODEL_ID = "eleven_multilingual_v2";
export const DEFAULT_OUTPUT_FORMAT = "mp3_44100_128";

/** What one request of this model may be given. */
export function maxCharsFor(modelId: string): number {
  return resolveSpeechModel(modelId).maxChars;
}

type ElevenAlignment = {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
};

type ElevenResponse = {
  audio_base64: string;
  alignment: ElevenAlignment | null;
  normalized_alignment: ElevenAlignment | null;
};

export class ElevenLabsError extends Error {
  // A plain field rather than a constructor parameter property, so modules
  // that import this one can be exercised under `node --experimental-strip-types`
  // without a build step.
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ElevenLabsError";
    this.status = status;
  }
}

export type SpeechResult = {
  audio: Buffer;
  alignment: Alignment;
  characterCount: number;
};

/**
 * Text to speech with per-character timestamps.
 *
 * We keep `alignment`, not `normalized_alignment`. Normalised alignment maps to
 * ElevenLabs' expanded reading of the text ("57" spoken as "siebenundfünfzig"),
 * whereas anchor phrases are searched in the voiceover exactly as written — so
 * only the raw alignment has offsets that line up with our own string indices.
 */
export async function synthesizeWithTimestamps({
  text,
  voiceId,
  apiKey,
  modelId = DEFAULT_MODEL_ID,
  outputFormat = DEFAULT_OUTPUT_FORMAT,
  speed,
  language,
  signal,
}: {
  text: string;
  voiceId: string;
  apiKey: string;
  modelId?: string;
  outputFormat?: string;
  /**
   * Which language to read it in, as an ISO code.
   *
   * Only sent to models that accept it. Multilingual v2 rejects the field
   * outright, and a rejected request costs the whole take — so the model's own
   * entry decides whether this is passed on, not the caller.
   */
  language?: string;
  /**
   * How fast it is read, as ElevenLabs' multiplier.
   *
   * Omitted rather than defaulted to 1, so a voice's own configured settings
   * keep applying when nobody asked for a speed. ElevenLabs accepts 0.7 to
   * 1.2; anything outside that is a 422, so it is clamped rather than passed
   * through — a rejected request costs the whole take.
   */
  speed?: number;
  signal?: AbortSignal;
}): Promise<SpeechResult> {
  const model = resolveSpeechModel(modelId);
  if (text.length > model.maxChars) {
    throw new ElevenLabsError(
      `Der Text ist ${text.length} Zeichen lang, ${model.label} nimmt höchstens ${model.maxChars}.`,
      400,
    );
  }

  const url = `${API_BASE}/text-to-speech/${encodeURIComponent(
    voiceId,
  )}/with-timestamps?output_format=${encodeURIComponent(outputFormat)}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text,
      model_id: modelId,
      // Sent only where it is understood. See SpeechModel.language.
      ...(language && model.language ? { language_code: language } : {}),
      ...(speed === undefined
        ? {}
        : {
            voice_settings: {
              speed: Math.min(1.2, Math.max(0.7, speed)),
            },
          }),
    }),
    signal,
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new ElevenLabsError(
      `ElevenLabs antwortete mit ${response.status}. ${summarizeError(detail)}`,
      response.status,
    );
  }

  const data = (await response.json()) as ElevenResponse;
  const raw = data.alignment ?? data.normalized_alignment;

  if (!raw || !Array.isArray(raw.characters) || raw.characters.length === 0) {
    // Named, and with the way out, because this is now a choice somebody made
    // rather than a fact about the only model there was. The timestamps are
    // what every picture change is timed from — without them the take is
    // worthless, so it is refused here instead of being stored and discovered
    // later as a video whose pictures drift.
    throw new ElevenLabsError(
      `${model.label} hat keine Zeichen-Timestamps zurückgegeben, und ohne die lassen sich die Bildwechsel nicht takten. Nimm ein anderes Sprachmodell.`,
      502,
    );
  }

  return {
    audio: Buffer.from(data.audio_base64, "base64"),
    characterCount: text.length,
    alignment: {
      characters: raw.characters,
      startTimesSeconds: raw.character_start_times_seconds,
      endTimesSeconds: raw.character_end_times_seconds,
    },
  };
}

/** Pull the human-readable bit out of an ElevenLabs error body. */
function summarizeError(body: string): string {
  try {
    const parsed = JSON.parse(body) as {
      detail?: { message?: string; status?: string } | string;
    };
    if (typeof parsed.detail === "string") return parsed.detail;
    if (parsed.detail?.message) return parsed.detail.message;
  } catch {
    // fall through to the truncated raw body
  }
  return body.slice(0, 200);
}

export type Voice = {
  voiceId: string;
  name: string;
  /** "premade", "cloned", "professional" — shown so the list can be grouped. */
  category?: string;
  /** Accent, age, gender, use case, as ElevenLabs labels them. */
  labels?: Record<string, string>;
  /**
   * The languages this voice has actually been verified in.
   *
   * The reason the studio can warn instead of guessing. A voice may be offered
   * by an account and still only ever have been checked in English; asked for
   * German it will produce German with an accent nobody chose. Empty means
   * ElevenLabs says nothing, which is not the same as "any language".
   */
  languages?: string[];
  /**
   * The models this voice is high quality on.
   *
   * A voice tuned for Multilingual v2 and not listed for Flash still speaks on
   * Flash — worse. Since Flash is the half-price option, the studio has to be
   * able to say which of the two the saving actually applies to.
   */
  models?: string[];
};

/** Voice list for the studio dropdown. Failure here is never fatal. */
export async function listVoices(apiKey: string): Promise<Voice[]> {
  const response = await fetch(`${API_BASE}/voices`, {
    headers: { "xi-api-key": apiKey },
  });
  if (!response.ok) return [];

  const data = (await response.json()) as {
    voices?: {
      voice_id: string;
      name: string;
      category?: string;
      labels?: Record<string, string>;
      high_quality_base_model_ids?: string[];
      verified_languages?: { language?: string }[];
    }[];
  };

  return (data.voices ?? []).map((v) => {
    // Deduplicated: ElevenLabs lists one entry per language AND model, so a
    // voice verified in four languages on three models arrives twelve times.
    const languages = [
      ...new Set(
        (v.verified_languages ?? [])
          .map((l) => l.language)
          .filter((l): l is string => Boolean(l)),
      ),
    ].sort();

    return {
      voiceId: v.voice_id,
      name: v.name,
      category: v.category,
      labels: v.labels,
      languages,
      models: v.high_quality_base_model_ids ?? [],
    } satisfies Voice;
  });
}

export type Language = { id: string; name: string };

/**
 * The languages the speaking model actually supports.
 *
 * Asked rather than hardcoded. A list written into the source is a list that
 * silently goes stale — the model gains languages, and a quiz that could have
 * used them never offers them because a constant somewhere says otherwise.
 */
export async function listLanguages(
  apiKey: string,
  modelId: string = DEFAULT_MODEL_ID,
): Promise<Language[]> {
  const response = await fetch(`${API_BASE}/models`, {
    headers: { "xi-api-key": apiKey },
  });
  if (!response.ok) {
    throw new ElevenLabsError(
      `ElevenLabs antwortete mit ${response.status} auf die Modell-Liste.`,
      response.status,
    );
  }

  const models = (await response.json()) as {
    model_id?: string;
    languages?: { language_id?: string; name?: string }[];
  }[];

  const model =
    models.find((m) => m.model_id === modelId) ??
    // Any multilingual model will do if the configured one is gone; an empty
    // language list would disable the format entirely for no good reason.
    models.find((m) => (m.languages?.length ?? 0) > 1);

  return (model?.languages ?? [])
    .filter((l): l is { language_id: string; name: string } =>
      Boolean(l.language_id && l.name),
    )
    .map((l) => ({ id: l.language_id, name: l.name }))
    .sort((a, b) => a.name.localeCompare(b.name, "de"));
}
