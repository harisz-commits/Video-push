import {
  ElevenLabsError,
  listVoices,
  synthesizeWithTimestamps,
} from "../../../lib/elevenlabs";
import { errorResponse, guard } from "../../../lib/guardrails";
import { VoiceRequest } from "../../../lib/schema";
import { writeBinary } from "../../../lib/store";

export const runtime = "nodejs";
export const maxDuration = 120;

/** Voice list for the studio dropdown. Cheap, so it only needs rate limiting. */
export async function GET() {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return Response.json({ voices: [] });

  const voices = await listVoices(apiKey).catch(() => []);
  return Response.json({
    voices,
    defaultVoiceId: process.env.ELEVENLABS_VOICE_ID ?? null,
  });
}

export async function POST(req: Request) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return errorResponse(
      "ELEVENLABS_API_KEY ist nicht gesetzt. Trag den Key in den Vercel-Projekt-Einstellungen ein.",
      500,
    );
  }

  let body: { projectId: string; voiceover: string; voiceId?: string };
  try {
    body = VoiceRequest.parse(await req.json());
  } catch {
    return errorResponse(
      "Ungültige Anfrage. Erwartet wird { projectId, voiceover, voiceId? }.",
      400,
    );
  }

  const voiceId = body.voiceId ?? process.env.ELEVENLABS_VOICE_ID;
  if (!voiceId) {
    return errorResponse(
      "Keine Stimme gewählt und ELEVENLABS_VOICE_ID ist nicht gesetzt.",
      400,
    );
  }

  const allowed = await guard(req, "voice", 4);
  if (!allowed.ok) return errorResponse(allowed.error, allowed.status);

  try {
    const { audio, alignment, characterCount } =
      await synthesizeWithTimestamps({
        text: body.voiceover,
        voiceId,
        apiKey,
      });

    // Overwritten per project id, so regenerating a voiceover replaces the take
    // instead of leaving an orphaned file behind for the cleanup cron.
    const audioUrl = await writeBinary(
      `audio/${sanitize(body.projectId)}.mp3`,
      audio,
      "audio/mpeg",
    );

    return Response.json({
      audioUrl,
      alignment,
      characterCount,
      durationSeconds:
        alignment.endTimesSeconds[alignment.endTimesSeconds.length - 1] ?? 0,
    });
  } catch (err) {
    if (err instanceof ElevenLabsError) {
      return errorResponse(err.message, err.status === 401 ? 500 : err.status);
    }
    // eslint-disable-next-line no-console
    console.error("[/api/voice]", err);
    return errorResponse(
      "Die Sprachausgabe ist fehlgeschlagen. Prüfe den ElevenLabs-Key und das Guthaben des Accounts.",
      500,
    );
  }
}

/** Keep project ids from escaping their prefix in the blob store. */
function sanitize(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64) || "projekt";
}
