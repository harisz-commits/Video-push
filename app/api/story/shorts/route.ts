import { waitUntil } from "@vercel/functions";
import { synthesizeWithTimestamps } from "../../../../lib/elevenlabs";
import { errorResponse, guard } from "../../../../lib/guardrails";
import { keyFor, keyNameFor } from "../../../../lib/llm";
import { mp3Duration } from "../../../../lib/mp3";
import { spellNumbers } from "../../../../lib/say-numbers";
import { resolveSpeechModel } from "../../../../lib/speech-models";
import { StoryProject, type StoryShort } from "../../../../lib/story";
import { proposeShorts, toShort } from "../../../../lib/story-shorts";
import { DEFAULT_STORY_MODEL } from "../../../../lib/story-pipeline";
import { resolveTextModel } from "../../../../lib/text-models";
import {
  readJson,
  storyShortsJobPath,
  writeBinary,
  writeJson,
  type StoryShortsJob,
} from "../../../../lib/store";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Cut a finished film into vertical shorts.
 *
 * Deliberately its own step behind its own button, and only offered once the
 * film has been rendered. Not because rendering is technically required — the
 * shorts are cut from the project, not from the MP4 — but because a film
 * nobody has watched through is not one anybody should be cutting highlights
 * from.
 *
 * Almost free: the pictures, the recording, the sound design and the cut all
 * already exist. What is spent here is one model call to choose the stretches
 * and about eighty characters of ElevenLabs per hook.
 */
export async function GET(req: Request) {
  const jobId = new URL(req.url).searchParams.get("jobId");
  if (!jobId || !/^[a-zA-Z0-9_-]{6,64}$/.test(jobId)) {
    return errorResponse("Ungültige oder fehlende jobId.", 400);
  }

  const job = await readJson<StoryShortsJob>(storyShortsJobPath(jobId));
  if (!job) return errorResponse("Zu dieser jobId gibt es keinen Auftrag.", 404);

  if (
    job.status === "running" &&
    Date.now() - job.startedAt > (maxDuration + 30) * 1000
  ) {
    return Response.json({
      ...job,
      status: "error",
      error: "Der Auftrag hat das Zeitlimit überschritten.",
    } satisfies StoryShortsJob);
  }
  return Response.json(job);
}

export async function POST(req: Request) {
  let project: StoryProject;
  let modelId: string;
  let voiceId: string | undefined;
  let speechModelId: string | undefined;
  try {
    const body = (await req.json()) as {
      project?: unknown;
      model?: unknown;
      voice?: unknown;
      speechModel?: unknown;
    };
    project = StoryProject.parse(body.project);
    modelId = typeof body.model === "string" ? body.model : DEFAULT_STORY_MODEL;
    voiceId = typeof body.voice === "string" ? body.voice : undefined;
    speechModelId =
      typeof body.speechModel === "string" ? body.speechModel : undefined;
  } catch {
    return errorResponse("Ungültige Anfrage. Erwartet wird das Video.", 400);
  }

  // Both are hard requirements rather than warnings. Without cues there are no
  // real durations, so a sixty-second cut would be a guess; without the
  // recording there is nothing to play under it.
  if (!project.audioUrl || project.cues?.length !== project.shots.length) {
    return errorResponse(
      "Für Shorts braucht dieses Video erst seine Stimme — die Ausschnitte werden aus den gemessenen Zeiten geschnitten.",
      400,
    );
  }

  const model = resolveTextModel(modelId);
  const apiKey = keyFor(model);
  if (!apiKey) {
    return errorResponse(`${keyNameFor(model)} ist nicht gesetzt.`, 500);
  }

  const allowed = await guard(req, "script", 4);
  if (!allowed.ok) return errorResponse(allowed.error, allowed.status);

  const jobId = `sh${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const startedAt = Date.now();
  await writeJson(storyShortsJobPath(jobId), {
    jobId,
    status: "running",
    step: "Ausschnitte werden gewählt",
    startedAt,
    updatedAt: startedAt,
  } satisfies StoryShortsJob);

  waitUntil(
    (async () => {
      const update = (patch: Partial<StoryShortsJob>) =>
        writeJson(storyShortsJobPath(jobId), {
          jobId,
          status: "running",
          startedAt,
          updatedAt: Date.now(),
          ...patch,
        } satisfies StoryShortsJob).catch(() => undefined);

      try {
        const { shorts: plans } = await proposeShorts({
          project,
          model,
          apiKey,
        });

        const shorts: StoryShort[] = plans.map(toShort);
        let characters = 0;
        let spoken = 0;

        const elevenKey = process.env.ELEVENLABS_API_KEY;
        const elevenVoice =
          voiceId ?? project.voice?.name ?? process.env.ELEVENLABS_VOICE_ID;

        if (elevenKey && elevenVoice) {
          // The same voice that read the film, unless told otherwise — a hook
          // in a different voice announces that it was bolted on.
          const speech = resolveSpeechModel(
            speechModelId ?? project.voice?.model,
          );

          for (const [i, short] of shorts.entries()) {
            await update({ step: `Hook ${i + 1} von ${shorts.length}` });
            try {
              const said = await synthesizeWithTimestamps({
                text: spellNumbers(short.hook),
                voiceId: elevenVoice,
                apiKey: elevenKey,
                modelId: speech.id,
                language: speech.language ? project.voice?.language : undefined,
                speed: project.speed,
              });
              short.hookAudioUrl = await writeBinary(
                `audio/short-${jobId}-${i}.mp3`,
                said.audio,
                "audio/mpeg",
              );
              short.hookSeconds = mp3Duration(said.audio) || undefined;
              characters += said.characterCount;
              spoken += 1;
            } catch {
              // A hook that will not record costs its short an opening line,
              // not its existence: without hookSeconds the composition simply
              // starts at the excerpt.
            }
          }
        }

        await writeJson(storyShortsJobPath(jobId), {
          jobId,
          status: "done",
          project: { ...project, shorts },
          hooks: spoken,
          characters,
          warning:
            spoken < shorts.length
              ? `${shorts.length - spoken} von ${shorts.length} Hooks konnten nicht gesprochen werden — diese Shorts beginnen direkt mit dem Ausschnitt.`
              : undefined,
          startedAt,
          updatedAt: Date.now(),
        } satisfies StoryShortsJob);
      } catch (err) {
        await writeJson(storyShortsJobPath(jobId), {
          jobId,
          status: "error",
          error: (err as Error).message.slice(0, 400),
          startedAt,
          updatedAt: Date.now(),
        } satisfies StoryShortsJob).catch(() => undefined);
      }
    })(),
  );

  return Response.json({ jobId });
}
