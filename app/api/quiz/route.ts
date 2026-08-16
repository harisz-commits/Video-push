import { waitUntil } from "@vercel/functions";
import { errorResponse, guard } from "../../../lib/guardrails";
import { keyFor, keyNameFor } from "../../../lib/llm";
import { generateQuiz } from "../../../lib/quiz-pipeline";
import { resolveTextModel, type TextModel } from "../../../lib/text-models";
import { quizJobPath, readJson, writeJson, type QuizJob } from "../../../lib/store";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Quiz generation, as a background job.
 *
 * Same shape as script and voice generation, for the same reason: the browser
 * must not be the thing keeping expensive work alive. Start it, get an id,
 * poll it, close the tab if you like.
 */
export async function POST(req: Request) {
  let topic: string;
  let count: number;
  let narrate = false;
  let narrateReveal = false;
  let model: TextModel;
  try {
    const body = (await req.json()) as {
      topic?: unknown;
      count?: unknown;
      narrate?: unknown;
      narrateReveal?: unknown;
      model?: unknown;
    };
    if (typeof body.topic !== "string" || body.topic.trim().length < 3) {
      throw new Error("topic");
    }
    topic = body.topic.trim().slice(0, 200);
    // Twelve is the default because it is about two minutes of video — long
    // enough to build a difficulty curve, short enough that one bad question
    // does not cost a five-minute render.
    count = Math.min(50, Math.max(4, Number(body.count) || 12));
    narrate = body.narrate === true;
    narrateReveal = body.narrateReveal === true;
    // Resolved against the closed catalogue rather than passed through: the id
    // arrives from a public page, and an id taken on trust is permission to
    // bill this account for whatever the provider sells.
    model = resolveTextModel(typeof body.model === "string" ? body.model : undefined);
  } catch {
    return errorResponse(
      "Ungültige Anfrage. Erwartet wird { topic: string, count?: number }.",
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

  // Refused up front rather than half way through: finding out that the voice
  // was never configured after fifty questions have been written and paid for
  // helps nobody.
  const elevenKey = process.env.ELEVENLABS_API_KEY;
  const voiceId = process.env.ELEVENLABS_VOICE_ID;
  if (narrate && !(elevenKey && voiceId)) {
    return errorResponse(
      "Vorlesen braucht ELEVENLABS_API_KEY und ELEVENLABS_VOICE_ID. Ohne die beiden lässt sich das Quiz nur stumm erzeugen.",
      500,
    );
  }

  const jobId = `q${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const startedAt = Date.now();

  await writeJson(quizJobPath(jobId), {
    jobId,
    topic,
    status: "running",
    startedAt,
    updatedAt: startedAt,
  } satisfies QuizJob);

  waitUntil(
    generateQuiz({
      jobId,
      topic,
      count,
      apiKey,
      model,
      narrate:
        narrate && elevenKey && voiceId
          ? { withReveal: narrateReveal, voiceId, elevenKey }
          : undefined,
      startedAt,
    }),
  );

  return Response.json({ jobId });
}

export async function GET(req: Request) {
  const jobId = new URL(req.url).searchParams.get("jobId");
  if (!jobId || !/^[a-zA-Z0-9_-]{6,64}$/.test(jobId)) {
    return errorResponse("Ungültige oder fehlende jobId.", 400);
  }

  const job = await readJson<QuizJob>(quizJobPath(jobId));
  if (!job) {
    return errorResponse("Zu dieser jobId gibt es kein Quiz.", 404);
  }

  // Nobody writes the failure for a function that was killed, so a job still
  // running past the ceiling is dead and saying so beats an endless spinner.
  if (
    job.status === "running" &&
    Date.now() - job.startedAt > (maxDuration + 30) * 1000
  ) {
    return Response.json({
      ...job,
      status: "error",
      error: "Die Erzeugung hat das Zeitlimit überschritten. Versuch es erneut.",
    } satisfies QuizJob);
  }

  return Response.json(job);
}
