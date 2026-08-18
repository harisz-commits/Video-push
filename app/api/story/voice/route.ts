import { waitUntil } from "@vercel/functions";
import { synthesizeWithTimestamps } from "../../../../lib/elevenlabs";
import {
  listGoogleVoices,
  mp3Duration,
  readCredentials,
  speakSegments,
} from "../../../../lib/google-tts";
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
 * Give a video its voice, from whichever provider was chosen.
 *
 * Its own route rather than a flag on /api/voice, because the two formats want
 * different answers back. The infographics film needs per-character timestamps
 * to find anchor phrases in a script somebody wrote; this format wrote its own
 * cut and needs one time per shot. Both providers can produce the second, only
 * one can produce the first — so forcing them through a route built around
 * character alignment would have ruled Google out on a technicality.
 */
export async function GET(req: Request) {
  const jobId = new URL(req.url).searchParams.get("jobId");

  // No jobId means "which voices can I choose from". Asked rather than
  // hardcoded: the Google catalogue depends on the account, and a dropdown
  // offering a voice the credentials cannot use is worse than a short list.
  if (!jobId) {
    const google = await listGoogleVoices("de-DE").catch(() => []);
    return Response.json({
      elevenlabs: Boolean(
        process.env.ELEVENLABS_API_KEY && process.env.ELEVENLABS_VOICE_ID,
      ),
      googleConfigured: readCredentials() !== null,
      google: google
        .map((v) => ({ name: v.name, gender: v.ssmlGender }))
        .sort((a, b) => a.name.localeCompare(b.name)),
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
  let provider: "elevenlabs" | "google";
  let voiceName: string | undefined;
  try {
    const body = (await req.json()) as {
      project?: unknown;
      provider?: unknown;
      voice?: unknown;
    };
    project = StoryProject.parse(body.project);
    provider = body.provider === "google" ? "google" : "elevenlabs";
    voiceName = typeof body.voice === "string" ? body.voice.slice(0, 120) : undefined;
  } catch {
    return errorResponse("Ungültige Anfrage. Erwartet wird das Video.", 400);
  }

  // Refused up front rather than half way through: finding out that the
  // credentials were never set after the whole narration has been assembled
  // helps nobody.
  if (provider === "google" && !readCredentials()) {
    return errorResponse(
      "Google-Stimmen brauchen GOOGLE_TTS_CREDENTIALS — das JSON eines Dienstkontos mit aktivierter Text-to-Speech-API. Ein API-Key reicht nicht: diese API lehnt Keys ab und verlangt OAuth2.",
      500,
    );
  }
  const elevenKey = process.env.ELEVENLABS_API_KEY;
  const elevenVoice = voiceName ?? process.env.ELEVENLABS_VOICE_ID;
  if (provider === "elevenlabs" && !(elevenKey && elevenVoice)) {
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
    step: provider === "google" ? "Google spricht" : "ElevenLabs spricht",
    startedAt,
    updatedAt: startedAt,
  } satisfies StoryVoiceJob);

  waitUntil(
    (async () => {
      try {
        // Numbers reach every voice as words. See lib/say-numbers.ts.
        const segments = project.shots.map((s) => spellNumbers(s.text.trim()));

        let audio: Buffer;
        let cues: number[];
        let seconds: number;
        let characters: number;

        if (provider === "google") {
          const result = await speakSegments({
            segments,
            voiceName: voiceName ?? "de-DE-Neural2-D",
            speakingRate: project.speed,
          });
          audio = result.audio;
          cues = result.cues;
          characters = result.characters;
          // Measured from the file, not from the last mark: the words after
          // the final mark are real time, and dropping them would cut the last
          // shot short.
          seconds = mp3Duration(result.audio);
        } else {
          const spoken = await synthesizeWithTimestamps({
            text: segments.join(" "),
            voiceId: elevenVoice!,
            apiKey: elevenKey!,
            speed: project.speed,
          });
          audio = spoken.audio;
          cues = cuesFromAlignment(project, spoken.alignment);
          characters = spoken.characterCount;
          const ends = spoken.alignment.endTimesSeconds;
          seconds = ends.length ? ends[ends.length - 1] : 0;
        }

        const audioUrl = await writeBinary(
          `audio/story-${jobId}.mp3`,
          audio,
          "audio/mpeg",
        );

        await writeJson(storyVoiceJobPath(jobId), {
          jobId,
          status: "done",
          audioUrl,
          cues,
          audioSeconds: seconds,
          characters,
          provider,
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
