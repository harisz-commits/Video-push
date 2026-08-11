import { waitUntil } from "@vercel/functions";
import {
  ElevenLabsError,
  listVoices,
  synthesizeWithTimestamps,
} from "../../../lib/elevenlabs";
import { errorResponse, guard } from "../../../lib/guardrails";
import { VoiceRequest } from "../../../lib/schema";
import {
  readJson,
  voiceJobPath,
  writeBinary,
  writeJson,
  type VoiceJob,
} from "../../../lib/store";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Two jobs behind one verb.
 *
 * With a `jobId` this reports on a synthesis in flight; without one it lists
 * the available voices for the dropdown. They share a route because they share
 * a noun, and splitting them would mean a second file whose only content is a
 * dropdown.
 */
export async function GET(req: Request) {
  const jobId = new URL(req.url).searchParams.get("jobId");
  if (jobId) return jobStatus(jobId);

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return Response.json({ voices: [] });

  const voices = await listVoices(apiKey).catch(() => []);
  return Response.json({
    voices,
    defaultVoiceId: process.env.ELEVENLABS_VOICE_ID ?? null,
  });
}

async function jobStatus(jobId: string): Promise<Response> {
  if (!/^[a-zA-Z0-9_-]{6,64}$/.test(jobId)) {
    return errorResponse("Ungültige jobId.", 400);
  }

  const job = await readJson<VoiceJob>(voiceJobPath(jobId));
  if (!job) {
    return errorResponse(
      "Zu dieser jobId gibt es keine Sprachausgabe. Entweder läuft sie noch nicht oder sie ist älter als die Aufbewahrungsfrist.",
      404,
    );
  }

  // Nobody is left to write a failure for a function that was killed, so a job
  // still "running" past the ceiling is dead. Saying so beats a spinner that
  // never stops.
  if (
    job.status === "running" &&
    Date.now() - job.startedAt > (maxDuration + 30) * 1000
  ) {
    return Response.json({
      ...job,
      status: "error",
      error:
        "Die Sprachausgabe hat das Zeitlimit überschritten. Versuch es noch einmal.",
    } satisfies VoiceJob);
  }

  return Response.json(job);
}

/**
 * Start a synthesis and hand back its id.
 *
 * Returns in milliseconds on purpose. The synthesis itself outlives this
 * response: a request held open for the length of the work gets aborted the
 * moment the browser backgrounds the tab, and an aborted request is
 * indistinguishable from a dead server from where the studio sits — while the
 * characters have already been spent at ElevenLabs either way.
 */
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

  const jobId = `v${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const startedAt = Date.now();

  const job: VoiceJob = {
    jobId,
    projectId: body.projectId,
    status: "running",
    startedAt,
    updatedAt: startedAt,
  };
  await writeJson(voiceJobPath(jobId), job);

  waitUntil(
    synthesize({
      job,
      text: body.voiceover,
      voiceId,
      apiKey,
    }),
  );

  return Response.json({ jobId });
}

async function synthesize({
  job,
  text,
  voiceId,
  apiKey,
}: {
  job: VoiceJob;
  text: string;
  voiceId: string;
  apiKey: string;
}): Promise<void> {
  try {
    const { audio, alignment, characterCount } = await synthesizeWithTimestamps(
      { text, voiceId, apiKey },
    );

    // Overwritten per project id, so regenerating a voiceover replaces the take
    // instead of leaving an orphaned file behind for the cleanup cron.
    const audioUrl = await writeBinary(
      `audio/${sanitize(job.projectId)}.mp3`,
      audio,
      "audio/mpeg",
    );

    await writeJson(voiceJobPath(job.jobId), {
      ...job,
      status: "done",
      audioUrl,
      alignment,
      characterCount,
      updatedAt: Date.now(),
    } satisfies VoiceJob);
  } catch (err) {
    const message =
      err instanceof ElevenLabsError
        ? err.message
        : "Die Sprachausgabe ist fehlgeschlagen. Prüfe den ElevenLabs-Key und das Guthaben des Accounts.";
    if (!(err instanceof ElevenLabsError)) {
      // eslint-disable-next-line no-console
      console.error("[/api/voice]", err);
    }

    await writeJson(voiceJobPath(job.jobId), {
      ...job,
      status: "error",
      error: message,
      updatedAt: Date.now(),
    } satisfies VoiceJob).catch(() => {
      // If even the failure cannot be recorded, the watchdog in jobStatus is
      // what stops the studio waiting forever.
    });
  }
}

/** Keep project ids from escaping their prefix in the blob store. */
function sanitize(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64) || "projekt";
}
