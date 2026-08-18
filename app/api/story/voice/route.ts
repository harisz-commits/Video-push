import { waitUntil } from "@vercel/functions";
import { synthesizeWithTimestamps } from "../../../../lib/elevenlabs";
import { errorResponse, guard } from "../../../../lib/guardrails";
import { spellNumbers } from "../../../../lib/say-numbers";
import { cuesFromAlignment, StoryProject } from "../../../../lib/story";
import {
  readJson,
  storyVoiceJobPath,
  writeBinary,
  writeJson,
  type StoryVoiceJob,
} from "../../../../lib/store";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Give a video its voice.
 *
 * Its own route rather than a flag on /api/voice, because the two formats want
 * different answers back. The infographics film needs per-character timestamps
 * to find anchor phrases in a script somebody wrote; this format wrote its own
 * cut and needs one time per shot. That reduction happens here.
 *
 * There was briefly a second provider here — Google Neural2, reached through a
 * service account and reporting its timing as SSML marks. It came out again on
 * request after it misbehaved in use. The cue shape it prompted stays, because
 * it is the right shape for this format regardless of who speaks.
 */
export async function GET(req: Request) {
  const jobId = new URL(req.url).searchParams.get("jobId");

  // No jobId means "can this account speak at all", which the studio asks
  // before it offers the button.
  if (!jobId) {
    return Response.json({
      elevenlabs: Boolean(
        process.env.ELEVENLABS_API_KEY && process.env.ELEVENLABS_VOICE_ID,
      ),
    });
  }

  if (!/^[a-zA-Z0-9_-]{6,64}$/.test(jobId)) {
    return errorResponse("Ungültige jobId.", 400);
  }

  const job = await readJson<StoryVoiceJob>(storyVoiceJobPath(jobId));
  if (!job) return errorResponse("Zu dieser jobId gibt es keinen Auftrag.", 404);

  if (
    job.status === "running" &&
    Date.now() - job.startedAt > (maxDuration + 30) * 1000
  ) {
    return Response.json({
      ...job,
      status: "error",
      error: "Der Auftrag hat das Zeitlimit überschritten.",
    } satisfies StoryVoiceJob);
  }

  return Response.json(job);
}

export async function POST(req: Request) {
  let project: StoryProject;
  let voiceName: string | undefined;
  try {
    const body = (await req.json()) as { project?: unknown; voice?: unknown };
    project = StoryProject.parse(body.project);
    voiceName = typeof body.voice === "string" ? body.voice.slice(0, 120) : undefined;
  } catch {
    return errorResponse("Ungültige Anfrage. Erwartet wird das Video.", 400);
  }

  // Refused up front rather than half way through: finding out that the key
  // was never set after the whole narration has been assembled helps nobody.
  const elevenKey = process.env.ELEVENLABS_API_KEY;
  const elevenVoice = voiceName ?? process.env.ELEVENLABS_VOICE_ID;
  if (!(elevenKey && elevenVoice)) {
    return errorResponse(
      "Sprechen braucht ELEVENLABS_API_KEY und ELEVENLABS_VOICE_ID.",
      500,
    );
  }

  const allowed = await guard(req, "voice", 2);
  if (!allowed.ok) return errorResponse(allowed.error, allowed.status);

  const jobId = `sv${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const startedAt = Date.now();

  await writeJson(storyVoiceJobPath(jobId), {
    jobId,
    status: "running",
    step: "Die Stimme wird aufgenommen",
    startedAt,
    updatedAt: startedAt,
  } satisfies StoryVoiceJob);

  waitUntil(
    (async () => {
      try {
        // Numbers reach every voice as words. See lib/say-numbers.ts.
        const segments = project.shots.map((s) => spellNumbers(s.text.trim()));

        const spoken = await synthesizeWithTimestamps({
          text: segments.join(" "),
          voiceId: elevenVoice,
          apiKey: elevenKey,
          speed: project.speed,
        });
        const cues = cuesFromAlignment(project, spoken.alignment);
        const ends = spoken.alignment.endTimesSeconds;
        const seconds = ends.length ? ends[ends.length - 1] : 0;

        const audioUrl = await writeBinary(
          `audio/story-${jobId}.mp3`,
          spoken.audio,
          "audio/mpeg",
        );

        await writeJson(storyVoiceJobPath(jobId), {
          jobId,
          status: "done",
          audioUrl,
          cues,
          audioSeconds: seconds,
          characters: spoken.characterCount,
          voice: voiceName,
          startedAt,
          updatedAt: Date.now(),
        } satisfies StoryVoiceJob);
      } catch (err) {
        await writeJson(storyVoiceJobPath(jobId), {
          jobId,
          status: "error",
          error: (err as Error).message.slice(0, 400),
          startedAt,
          updatedAt: Date.now(),
        } satisfies StoryVoiceJob).catch(() => undefined);
      }
    })(),
  );

  return Response.json({ jobId });
}
