import { createSign } from "node:crypto";

/**
 * Google Cloud Text-to-Speech, as a second voice for the video format.
 *
 * Two things about it are genuinely different from ElevenLabs, and both shape
 * this file.
 *
 * It will not take an API key. The catalogue endpoint answers a Gemini key
 * with "API keys are not supported by this API. Expected OAuth2 access token
 * or other authentication credentials that assert a principal" — so this signs
 * a JWT with a service account's private key and trades it for an access
 * token. That is the only way in, and it is why this needs a credentials JSON
 * rather than a key string.
 *
 * And it reports timing differently, in a way that happens to suit this format
 * better. ElevenLabs returns a timestamp per character, which the video format
 * then has to map back to shot boundaries by counting offsets. Google returns
 * a timestamp per <mark> tag — and marks are exactly what a shot boundary is.
 * The cut comes back measured rather than derived.
 */

export class GoogleTtsError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "GoogleTtsError";
    this.status = status;
  }
}

type ServiceAccount = {
  client_email: string;
  private_key: string;
  project_id?: string;
};

/**
 * The service account, from one environment variable.
 *
 * Accepts the JSON verbatim or base64-encoded, because a multi-line private
 * key pasted into a dashboard field is the single most common way this breaks
 * — some UIs eat the newlines, and a key without them is silently invalid.
 * The escaped-newline repair below handles the third variant.
 */
export function readCredentials(): ServiceAccount | null {
  const raw = process.env.GOOGLE_TTS_CREDENTIALS;
  if (!raw) return null;

  const text = raw.trim().startsWith("{")
    ? raw
    : Buffer.from(raw, "base64").toString("utf8");

  let parsed: ServiceAccount;
  try {
    parsed = JSON.parse(text) as ServiceAccount;
  } catch {
    return null;
  }
  if (!parsed.client_email || !parsed.private_key) return null;

  return {
    ...parsed,
    // A dashboard that stored the JSON as a single line leaves the key's
    // newlines as the two characters backslash-n. RS256 then fails with an
    // unhelpful decoder error rather than anything naming the cause.
    private_key: parsed.private_key.replace(/\\n/g, "\n"),
  };
}

/**
 * An access token, minted from the service account and kept until it expires.
 *
 * Cached in module scope, which on a serverless function means "for the life
 * of this instance". Tokens last an hour and a mint costs a round trip, so a
 * warm instance synthesising fifty chunks does it once instead of fifty times.
 */
let cached: { token: string; expiresAt: number } | null = null;

async function accessToken(account: ServiceAccount): Promise<string> {
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: account.client_email,
    scope: "https://www.googleapis.com/auth/cloud-platform",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  };

  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const unsigned = `${encode(header)}.${encode(claims)}`;

  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  const signature = signer.sign(account.private_key).toString("base64url");

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsigned}.${signature}`,
    }),
  });

  const raw = await response.text().catch(() => "");
  if (!response.ok) {
    throw new GoogleTtsError(
      `Google hat den Dienstkonto-Zugang abgelehnt (${response.status}). ${summarize(raw)}`,
      response.status,
    );
  }

  const body = JSON.parse(raw) as { access_token?: string; expires_in?: number };
  if (!body.access_token) {
    throw new GoogleTtsError("Google hat kein Zugriffstoken zurückgegeben.", 502);
  }

  cached = {
    token: body.access_token,
    expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
  };
  return cached.token;
}

export type GoogleVoice = {
  name: string;
  languageCodes: string[];
  ssmlGender?: string;
};

/** Which voices this account may actually use. Asked, never assumed. */
export async function listGoogleVoices(
  languageCode = "de-DE",
): Promise<GoogleVoice[]> {
  const account = readCredentials();
  if (!account) return [];

  const token = await accessToken(account);
  const response = await fetch(
    `https://texttospeech.googleapis.com/v1/voices?languageCode=${encodeURIComponent(languageCode)}`,
    { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" },
  );
  if (!response.ok) return [];
  const body = (await response.json()) as { voices?: GoogleVoice[] };
  return body.voices ?? [];
}

/**
 * How much text goes into one request.
 *
 * The endpoint takes 5,000 bytes of input, and SSML markup counts against it —
 * so the budget here is on the assembled SSML, not on the spoken words, and it
 * is set below the limit rather than at it. German in UTF-8 is not one byte
 * per character, and a request rejected for being 40 bytes over costs the
 * whole chunk.
 */
const SSML_BUDGET = 4200;

export type Narration = {
  audio: Buffer;
  /** One entry per segment: when it starts, in seconds. */
  cues: number[];
  /** Characters billed, for reporting. Markup is not counted by Google. */
  characters: number;
};

/**
 * Speak a list of segments and report where each one begins.
 *
 * The segments are the shots. Each gets a <mark> before it, and the marks come
 * back as timings — so the cut is measured rather than inferred from character
 * offsets, which is what the ElevenLabs path has to do.
 *
 * Long narrations are split across requests at segment boundaries, never
 * mid-sentence, and the timings of later chunks are shifted by the measured
 * duration of the audio before them. Splitting mid-sentence would put an
 * audible seam in the middle of a word; splitting between shots puts it where
 * the picture changes anyway.
 */
export async function speakSegments(args: {
  segments: string[];
  voiceName: string;
  languageCode?: string;
  /** 0.25 to 4.0. The video format uses 1.15. */
  speakingRate?: number;
}): Promise<Narration> {
  const account = readCredentials();
  if (!account) {
    throw new GoogleTtsError(
      "GOOGLE_TTS_CREDENTIALS ist nicht gesetzt. Google-Stimmen brauchen ein Dienstkonto (JSON) — ein API-Key wird von dieser API abgelehnt.",
      500,
    );
  }
  const token = await accessToken(account);
  const languageCode = args.languageCode ?? "de-DE";

  const chunks = chunkSegments(args.segments);
  const parts: Buffer[] = [];
  const cues: number[] = [];
  let offset = 0;
  let characters = 0;

  for (const chunk of chunks) {
    const ssml = toSsml(chunk.segments, chunk.firstIndex);

    const response = await fetch(
      "https://texttospeech.googleapis.com/v1beta1/text:synthesize",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          input: { ssml },
          voice: { languageCode, name: args.voiceName },
          audioConfig: {
            audioEncoding: "MP3",
            speakingRate: Math.min(4, Math.max(0.25, args.speakingRate ?? 1)),
            // Fixed, because the chunks are concatenated: two MP3s at
            // different sample rates joined end to end play at the wrong pitch
            // from the seam onwards.
            sampleRateHertz: 24000,
          },
          enableTimePointing: ["SSML_MARK"],
        }),
      },
    );

    const raw = await response.text().catch(() => "");
    if (!response.ok) {
      throw new GoogleTtsError(
        `Google Text-to-Speech antwortete mit ${response.status}. ${summarize(raw)}`,
        response.status,
      );
    }

    const body = JSON.parse(raw) as {
      audioContent?: string;
      timepoints?: { markName?: string; timeSeconds?: number }[];
    };
    if (!body.audioContent) {
      throw new GoogleTtsError("Google hat kein Audio zurückgegeben.", 502);
    }

    const audio = Buffer.from(body.audioContent, "base64");
    parts.push(audio);
    characters += chunk.segments.join(" ").length;

    const byMark = new Map(
      (body.timepoints ?? [])
        .filter((t) => typeof t.markName === "string")
        .map((t) => [t.markName as string, t.timeSeconds ?? 0]),
    );

    chunk.segments.forEach((_, i) => {
      const index = chunk.firstIndex + i;
      // A mark Google did not report falls back to the previous cue, which
      // holds the picture a little longer rather than jumping it to zero.
      const seconds = byMark.get(`s${index}`);
      cues.push(offset + (seconds ?? (cues.length ? cues[cues.length - 1] - offset : 0)));
    });

    // Measured from the audio itself, not from the last timepoint: the tail
    // after the final mark is real time, and dropping it would pull every
    // later chunk earlier — an error that compounds with every chunk.
    offset += mp3Duration(audio);
  }

  // Cast because @types/node models Buffer as Uint8Array<ArrayBufferLike>
  // while concat wants Uint8Array<ArrayBuffer>; the values are the same bytes.
  return {
    audio: Buffer.concat(parts as unknown as Uint8Array[]),
    cues,
    characters,
  };
}

type Chunk = { segments: string[]; firstIndex: number };

function chunkSegments(segments: string[]): Chunk[] {
  const chunks: Chunk[] = [];
  let current: string[] = [];
  let firstIndex = 0;
  let size = 0;

  segments.forEach((segment, i) => {
    // The markup that will wrap this segment, counted with it.
    const cost = Buffer.byteLength(segment, "utf8") + 40;
    if (current.length > 0 && size + cost > SSML_BUDGET) {
      chunks.push({ segments: current, firstIndex });
      current = [];
      firstIndex = i;
      size = 0;
    }
    current.push(segment);
    size += cost;
  });

  if (current.length > 0) chunks.push({ segments: current, firstIndex });
  return chunks;
}

function toSsml(segments: string[], firstIndex: number): string {
  const body = segments
    .map((text, i) => `<mark name="s${firstIndex + i}"/>${escapeSsml(text)}`)
    .join(" ");
  return `<speak>${body}</speak>`;
}

/** SSML is XML: an unescaped ampersand in a German sentence breaks the request. */
function escapeSsml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * How long an MP3 is, by walking its frames.
 *
 * Needed because chunks are concatenated and every chunk after the first has
 * to be shifted by the real duration of everything before it. The last
 * timepoint is not that duration — it is where the last mark was, and the
 * words after it still take time. Using it would pull each chunk earlier than
 * the one before, and the error would accumulate down the whole video.
 */
export function mp3Duration(buffer: Buffer): number {
  const RATES = [
    0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0,
  ];
  const FREQ: Record<number, number[]> = {
    3: [44100, 48000, 32000], // MPEG-1
    2: [22050, 24000, 16000], // MPEG-2
    0: [11025, 12000, 8000], // MPEG-2.5
  };

  let i = 0;
  let seconds = 0;

  while (i < buffer.length - 4) {
    if (buffer[i] !== 0xff || (buffer[i + 1] & 0xe0) !== 0xe0) {
      i += 1;
      continue;
    }
    const version = (buffer[i + 1] >> 3) & 0x03;
    const bitrateIndex = (buffer[i + 2] >> 4) & 0x0f;
    const sampleIndex = (buffer[i + 2] >> 2) & 0x03;
    const padding = (buffer[i + 2] >> 1) & 0x01;

    const rates = FREQ[version];
    if (!rates || bitrateIndex === 0 || bitrateIndex === 15 || sampleIndex === 3) {
      i += 1;
      continue;
    }
    const bitrate = RATES[bitrateIndex] * 1000;
    const sampleRate = rates[sampleIndex];
    if (!bitrate || !sampleRate) {
      i += 1;
      continue;
    }

    const samples = version === 3 ? 1152 : 576;
    const length = Math.floor((samples / 8) * (bitrate / sampleRate)) + padding;
    if (length <= 0) {
      i += 1;
      continue;
    }

    seconds += samples / sampleRate;
    i += length;
  }

  return seconds;
}

function summarize(detail: string): string {
  try {
    const parsed = JSON.parse(detail) as { error?: { message?: string } };
    if (parsed.error?.message) return parsed.error.message.slice(0, 300);
  } catch {
    // Not JSON; the raw body is the next best thing.
  }
  return detail.slice(0, 300);
}
