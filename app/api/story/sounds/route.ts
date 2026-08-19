import { waitUntil } from "@vercel/functions";
import { errorResponse, guard } from "../../../../lib/guardrails";
import { generateSounds, soundCost } from "../../../../lib/sfx";
import { StoryProject } from "../../../../lib/story";
import {
  readJson,
  storySoundJobPath,
  writeJson,
  type StorySoundJob,
} from "../../../../lib/store";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Generate the sound design for a video.
 *
 * Its own step and its own button, like the pictures, and for the same reason:
 * it spends the ElevenLabs allowance, and nothing should spend that before
 * somebody has read what it is buying. Only sounds with no file are attempted,
 * so a second run after a partial failure costs the remainder.
 */
export async function POST(req: Request) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return errorResponse(
      "ELEVENLABS_API_KEY ist nicht gesetzt — ohne den Key lassen sich keine Geräusche erzeugen.",
      500,
    );
  }

  let project: StoryProject;
  try {
    const body = (await req.json()) as { project?: unknown };
    project = StoryProject.parse(body.project);
  } catch {
    return errorResponse("Ungültige Anfrage. Erwartet wird das Video.", 400);
  }

  const plan = soundCost(project);
  if (plan.sounds === 0) {
    return errorResponse("Für dieses Video ist bereits jedes Geräusch erzeugt.", 400);
  }

  const allowed = await guard(req, "voice", 1);
  if (!allowed.ok) return errorResponse(allowed.error, allowed.status);

  const jobId = `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const startedAt = Date.now();

  await writeJson(storySoundJobPath(jobId), {
    jobId,
    status: "running",
    step: `${plan.sounds} ${plan.sounds === 1 ? "Geräusch" : "Geräusche"}`,
    startedAt,
    updatedAt: startedAt,
  } satisfies StorySoundJob);

  waitUntil(
    (async () => {
      try {
        const result = await generateSounds({
          project,
          apiKey,
          deadline: startedAt + (maxDuration - 40) * 1000,
          onProgress: async (done, total) => {
            await writeJson(storySoundJobPath(jobId), {
              jobId,
              status: "running",
              step: `Geräusch ${done} von ${total}`,
              startedAt,
              updatedAt: Date.now(),
            } satisfies StorySoundJob).catch(() => undefined);
          },
        });

        const notes: string[] = [];
        if (result.skipped > 0) {
          notes.push(
            `Die Zeit reichte für ${result.skipped} Geräusche nicht. Drück noch einmal — fertige werden nicht erneut bezahlt.`,
          );
        }
        if (result.failed.length > 0) {
          notes.push(
            `Nicht erzeugt: ${result.failed.map((f) => f.key).join(", ")} (${result.failed[0].reason})`,
          );
        }

        await writeJson(storySoundJobPath(jobId), {
          jobId,
          status: "done",
          project: result.project,
          made: result.made,
          reused: result.reused,
          characters: result.characters,
          warning: notes.length ? notes.join(" ") : undefined,
          startedAt,
          updatedAt: Date.now(),
        } satisfies StorySoundJob);
      } catch (err) {
        await writeJson(storySoundJobPath(jobId), {
          jobId,
          status: "error",
          error: (err as Error).message.slice(0, 400),
          startedAt,
          updatedAt: Date.now(),
        } satisfies StorySoundJob).catch(() => undefined);
      }
    })(),
  );

  return Response.json({ jobId, ...plan });
}

export async function GET(req: Request) {
  const jobId = new URL(req.url).searchParams.get("jobId");
  if (!jobId || !/^[a-zA-Z0-9_-]{6,64}$/.test(jobId)) {
    return errorResponse("Ungültige oder fehlende jobId.", 400);
  }

  const job = await readJson<StorySoundJob>(storySoundJobPath(jobId));
  if (!job) return errorResponse("Zu dieser jobId gibt es keinen Auftrag.", 404);

  if (
    job.status === "running" &&
    Date.now() - job.startedAt > (maxDuration + 30) * 1000
  ) {
    return Response.json({
      ...job,
      status: "error",
      error: "Der Auftrag hat das Zeitlimit überschritten.",
    } satisfies StorySoundJob);
  }

  return Response.json(job);
}
