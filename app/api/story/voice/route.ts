import { waitUntil } from "@vercel/functions";
import { synthesizeWithTimestamps } from "../../../../lib/elevenlabs";
import { errorResponse, guard } from "../../../../lib/guardrails";
import { spellNumbers } from "../../../../lib/say-numbers";
import { mp3Duration } from "../../../../lib/mp3";
import {
  chunkSegments,
  cuesForSegments,
  StoryProject,
} from "../../../../lib/story";
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
 * Characters per request.
 *
 * The API refuses more than 9,500 outright, and refusing is what it did: a
 * twenty-five minute script is 28,747 characters, so every long video failed
 * in milliseconds without spending a single credit. Set below the limit rather
 * than at it, because the cut can only fall between shots and the last shot
 * before the boundary has to fit.
 */
const CHARS_PER_REQUEST = 9_000;

/**
 * When to give up rather than be killed mid-recording.
 *
 * Unlike the quiz, whose clips are independent, this is one continuous track:
 * half of it is worth nothing. So a run that cannot finish says so instead of
 * leaving a truncated voiceover behind.
 */
const DEADLINE_MS = 250_000;

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

        // Recorded in as many requests as the length needs, joined end to
        // end. The cut always falls between shots, where the picture changes
        // anyway, so a seam has somewhere to hide.
        const chunks = chunkSegments(segments, CHARS_PER_REQUEST);
        const parts: Buffer[] = [];
        const cues: number[] = [];
        let offset = 0;
        let characters = 0;

        for (const [index, chunk] of chunks.entries()) {
          if (Date.now() > startedAt + DEADLINE_MS) {
            throw new Error(
              `Die Zeit reichte nur für ${index} von ${chunks.length} Aufnahmen. Ein Video dieser Länge lässt sich derzeit nicht in einem Durchgang vertonen — nimm eine kürzere Länge.`,
            );
          }
          if (chunks.length > 1) {
            await writeJson(storyVoiceJobPath(jobId), {
              jobId,
              status: "running",
              step: `Aufnahme ${index + 1} von ${chunks.length}`,
              startedAt,
              updatedAt: Date.now(),
            } satisfies StoryVoiceJob).catch(() => undefined);
          }

          const spoken = await synthesizeWithTimestamps({
            text: chunk.segments.join(" "),
            voiceId: elevenVoice,
            apiKey: elevenKey,
            speed: project.speed,
          });

          for (const seconds of cuesForSegments(chunk.segments, spoken.alignment)) {
            cues.push(offset + seconds);
          }
          parts.push(spoken.audio);
          characters += spoken.characterCount;
          // Measured from the file, not from the last timestamp: the sound
          // after the final character is real time, and treating it as zero
          // would pull every later chunk forward.
          offset += mp3Duration(spoken.audio);
        }

        const seconds = offset;
        const audioUrl = await writeBinary(
          `audio/story-${jobId}.mp3`,
          Buffer.concat(parts as unknown as Uint8Array[]),
          "audio/mpeg",
        );

        await writeJson(storyVoiceJobPath(jobId), {
          jobId,
          status: "done",
          audioUrl,
          cues,
          audioSeconds: seconds,
          characters,
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
