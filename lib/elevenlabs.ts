import type { Alignment } from "./schema";

const API_BASE = "https://api.elevenlabs.io/v1";

/**
 * Per-request character ceiling for eleven_multilingual_v2.
 *
 * A 750-850 word German voiceover is roughly 5,000-5,800 characters, so a
 * single request is enough and we never have to stitch MP3s together. We check
 * anyway and fail with a clear message rather than letting ElevenLabs truncate
 * the text silently — a truncated take would desync every scene after it.
 */
const MAX_CHARS = 9_500;

export const DEFAULT_MODEL_ID = "eleven_multilingual_v2";
export const DEFAULT_OUTPUT_FORMAT = "mp3_44100_128";

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
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ElevenLabsError";
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
  signal,
}: {
  text: string;
  voiceId: string;
  apiKey: string;
  modelId?: string;
  outputFormat?: string;
  signal?: AbortSignal;
}): Promise<SpeechResult> {
  if (text.length > MAX_CHARS) {
    throw new ElevenLabsError(
      `Das Voiceover ist ${text.length} Zeichen lang, das Limit liegt bei ${MAX_CHARS}. Kürze das Skript auf 750 bis 850 Wörter.`,
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
    body: JSON.stringify({ text, model_id: modelId }),
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
    throw new ElevenLabsError(
      "ElevenLabs hat kein Alignment zurückgegeben. Ohne Zeichen-Timestamps lassen sich die Szenen nicht takten.",
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

export type Voice = { voiceId: string; name: string };

/** Voice list for the studio dropdown. Failure here is never fatal. */
export async function listVoices(apiKey: string): Promise<Voice[]> {
  const response = await fetch(`${API_BASE}/voices`, {
    headers: { "xi-api-key": apiKey },
  });
  if (!response.ok) return [];

  const data = (await response.json()) as {
    voices?: { voice_id: string; name: string }[];
  };
  return (data.voices ?? []).map((v) => ({ voiceId: v.voice_id, name: v.name }));
}
