import { waitUntil } from "@vercel/functions";
import { errorResponse, guard } from "../../../../lib/guardrails";
import { resolveModel } from "../../../../lib/image-models";
import { StoryProject } from "../../../../lib/story";
import { drawStoryImages } from "../../../../lib/story-images";
import {
  readJson,
  storyImageJobPath,
  writeJson,
  type StoryImageJob,
} from "../../../../lib/store";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Draw the pictures a video is missing.
 *
 * The expensive half, behind its own button. Only pictures with no url are
 * attempted, so running this twice after a partial failure costs the
 * remainder — which on a film of a hundred pictures is the difference between
 * three dollars and six.
 */
export async function POST(req: Request) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return errorResponse(
      "GEMINI_API_KEY ist nicht gesetzt — ohne den Key lassen sich keine Bilder zeichnen.",
      500,
    );
  }

  let project: StoryProject;
  let modelId: string | undefined;
  /** Nur so viele zeichnen — für die Stilvorschau. */
  let limit: number | undefined;
  try {
    const body = (await req.json()) as {
      project?: unknown;
      model?: unknown;
      limit?: unknown;
    };
    project = StoryProject.parse(body.project);
    modelId = typeof body.model === "string" ? body.model : undefined;
    limit =
      Number.isFinite(Number(body.limit)) && Number(body.limit) > 0
        ? Math.min(20, Math.max(1, Math.round(Number(body.limit))))
        : undefined;
  } catch {
    return errorResponse("Ungültige Anfrage. Erwartet wird das Video.", 400);
  }

  // Resolved against the closed catalogue rather than passed through: the id
  // arrives from a public page, and an id taken on trust is permission to bill
  // this account for whatever Google sells at whatever it costs.
  const model = resolveModel(modelId);

  const wanted = project.images.filter((i) => !i.url).length;
  if (wanted === 0) {
    return errorResponse("Für dieses Video ist bereits jedes Bild gezeichnet.", 400);
  }

  const allowed = await guard(req, "script", 2);
  if (!allowed.ok) return errorResponse(allowed.error, allowed.status);

  const jobId = `i${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const startedAt = Date.now();

  await writeJson(storyImageJobPath(jobId), {
    jobId,
    status: "running",
    step: `${wanted} ${wanted === 1 ? "Bild" : "Bilder"} werden gezeichnet`,
    startedAt,
    updatedAt: startedAt,
  } satisfies StoryImageJob);

  waitUntil(
    (async () => {
      try {
        const result = await drawStoryImages({
          project,
          apiKey,
          model,
          limit,
          // Forty seconds of headroom, so the job always gets to write what it
          // managed. A hundred pictures outlast one function; being killed
          // half way would lose every picture already paid for.
          deadline: startedAt + (maxDuration - 40) * 1000,
          onProgress: async (done, total) => {
            await writeJson(storyImageJobPath(jobId), {
              jobId,
              status: "running",
              step: `Bild ${done} von ${total}`,
              startedAt,
              updatedAt: Date.now(),
            } satisfies StoryImageJob).catch(() => undefined);
          },
        });

        const notes: string[] = [];
        if (result.skipped > 0) {
          notes.push(
            `Die Zeit reichte für ${result.skipped} ${result.skipped === 1 ? "Bild" : "Bilder"} nicht. Drück noch einmal auf Zeichnen — fertige Bilder werden nicht erneut bezahlt.`,
          );
        }
        if (result.failed.length > 0) {
          notes.push(
            `Nicht gezeichnet: ${result.failed.map((f) => f.key).join(", ")} (${result.failed[0].reason})`,
          );
        }

        await writeJson(storyImageJobPath(jobId), {
          jobId,
          status: "done",
          project: result.project,
          drawn: result.drawn,
          reused: result.reused,
          cents: result.cents,
          warning: notes.length ? notes.join(" ") : undefined,
          startedAt,
          updatedAt: Date.now(),
        } satisfies StoryImageJob);
      } catch (err) {
        await writeJson(storyImageJobPath(jobId), {
          jobId,
          status: "error",
          error: (err as Error).message.slice(0, 400),
          startedAt,
          updatedAt: Date.now(),
        } satisfies StoryImageJob).catch(() => undefined);
      }
    })(),
  );

  return Response.json({ jobId, images: wanted, cents: Number((wanted * model.cents).toFixed(2)) });
}

export async function GET(req: Request) {
  const jobId = new URL(req.url).searchParams.get("jobId");
  if (!jobId || !/^[a-zA-Z0-9_-]{6,64}$/.test(jobId)) {
    return errorResponse("Ungültige oder fehlende jobId.", 400);
  }

  const job = await readJson<StoryImageJob>(storyImageJobPath(jobId));
  if (!job) return errorResponse("Zu dieser jobId gibt es keinen Auftrag.", 404);

  if (
    job.status === "running" &&
    Date.now() - job.startedAt > (maxDuration + 30) * 1000
  ) {
    return Response.json({
      ...job,
      status: "error",
      error: "Der Auftrag hat das Zeitlimit überschritten.",
    } satisfies StoryImageJob);
  }

  return Response.json(job);
}
