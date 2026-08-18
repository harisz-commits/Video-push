import { waitUntil } from "@vercel/functions";
import { errorResponse, guard } from "../../../lib/guardrails";
import { keyFor, keyNameFor } from "../../../lib/llm";
import { DEFAULT_STORY_MODEL, generateStory } from "../../../lib/story-pipeline";
import { resolveTextModel, type TextModel } from "../../../lib/text-models";
import { readJson, storyJobPath, writeJson, type StoryJob } from "../../../lib/store";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Write a video: the script and the picture list, nothing drawn.
 *
 * The split from drawing is the whole design. This costs well under a cent and
 * takes under a minute; drawing the same film costs dollars and takes many.
 * Producing the cheap half first means a script that comes back wrong can be
 * thrown away for nothing, which is the only way a format this expensive is
 * usable at all.
 */
export async function POST(req: Request) {
  let topic: string;
  let minutes: number;
  let imageBudget: number;
  let model: TextModel;
  try {
    const body = (await req.json()) as {
      topic?: unknown;
      minutes?: unknown;
      imageBudget?: unknown;
      model?: unknown;
    };
    if (typeof body.topic !== "string" || body.topic.trim().length < 3) {
      throw new Error("topic");
    }
    // Long, because the topic here is a briefing rather than a subject line —
    // "Ägypter und wie sie die Hitze überlebt haben, bitte viel über Baustoffe".
    topic = body.topic.trim().slice(0, 2000);

    // Twenty-five is the stated ceiling. It is not yet the renderable ceiling:
    // a restored sandbox lives five minutes and cannot be extended, so a film
    // beyond roughly six minutes has to be rendered in sections. The script
    // itself is fine at any length in this range, so the limit stays here and
    // the render route is what will have to grow.
    minutes = Math.min(25, Math.max(1, Number(body.minutes) || 5));

    // The money knob. Every picture beyond this is one the writer has to do
    // without by making a motif come back instead.
    imageBudget = Math.min(400, Math.max(4, Number(body.imageBudget) || 60));

    model = resolveTextModel(
      typeof body.model === "string" ? body.model : DEFAULT_STORY_MODEL,
    );
  } catch {
    return errorResponse(
      "Ungültige Anfrage. Erwartet wird { topic: string, minutes?: number, imageBudget?: number }.",
      400,
    );
  }

  const apiKey = keyFor(model);
  if (!apiKey) {
    return errorResponse(
      `${keyNameFor(model)} ist nicht gesetzt — ${model.label} lässt sich ohne diesen Key nicht aufrufen.`,
      500,
    );
  }

  const allowed = await guard(req, "script", 4);
  if (!allowed.ok) return errorResponse(allowed.error, allowed.status);

  const jobId = `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const startedAt = Date.now();

  await writeJson(storyJobPath(jobId), {
    jobId,
    topic,
    status: "running",
    startedAt,
    updatedAt: startedAt,
  } satisfies StoryJob);

  waitUntil(
    generateStory({ jobId, topic, minutes, imageBudget, apiKey, model, startedAt }),
  );

  return Response.json({ jobId });
}

export async function GET(req: Request) {
  const jobId = new URL(req.url).searchParams.get("jobId");
  if (!jobId || !/^[a-zA-Z0-9_-]{6,64}$/.test(jobId)) {
    return errorResponse("Ungültige oder fehlende jobId.", 400);
  }

  const job = await readJson<StoryJob>(storyJobPath(jobId));
  if (!job) return errorResponse("Zu dieser jobId gibt es kein Video.", 404);

  if (
    job.status === "running" &&
    Date.now() - job.startedAt > (maxDuration + 30) * 1000
  ) {
    return Response.json({
      ...job,
      status: "error",
      error: "Die Erzeugung hat das Zeitlimit überschritten. Versuch es erneut.",
    } satisfies StoryJob);
  }

  return Response.json(job);
}
