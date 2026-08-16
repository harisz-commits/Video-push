import { waitUntil } from "@vercel/functions";
import { errorResponse, guard } from "../../../../lib/guardrails";
import { keyFor, keyNameFor } from "../../../../lib/llm";
import { QuizQuestion } from "../../../../lib/quiz";
import { availableFlags } from "../../../../lib/quiz-pipeline";
import { askedQuestions } from "../../../../lib/quiz-history";
import { rewriteQuestions } from "../../../../lib/quiz-requestion";
import { resolveTextModel, type TextModel } from "../../../../lib/text-models";
import {
  quizEditJobPath,
  readJson,
  writeJson,
  type QuizEditJob,
} from "../../../../lib/store";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Rewrite some of the questions in an existing quiz.
 *
 * A job like everything else that calls a model: this takes tens of seconds
 * and must survive the tab going away.
 */
export async function POST(req: Request) {
  let topic: string;
  let questions: QuizQuestion[];
  let replace: number[];
  let model: TextModel;
  try {
    const body = (await req.json()) as {
      topic?: unknown;
      questions?: unknown;
      replace?: unknown;
      model?: unknown;
    };
    model = resolveTextModel(
      typeof body.model === "string" ? body.model : undefined,
    );
    topic =
      typeof body.topic === "string" && body.topic.trim()
        ? body.topic.trim().slice(0, 200)
        : "Allgemeinwissen";

    const parsed = QuizQuestion.array().safeParse(body.questions);
    if (!parsed.success || parsed.data.length === 0) throw new Error("questions");
    questions = parsed.data;

    const wanted = Array.isArray(body.replace) ? body.replace : [];
    replace = [
      ...new Set(
        wanted
          .map((n) => Number(n))
          .filter((n) => Number.isInteger(n) && n >= 0 && n < questions.length),
      ),
    ].sort((a, b) => a - b);
    // Ten at a time. Beyond that the reply starts running into the token
    // ceiling, and "regenerate everything" is what the generate button is for.
    if (replace.length === 0 || replace.length > 10) throw new Error("replace");
  } catch {
    return errorResponse(
      "Ungültige Anfrage. Erwartet werden die Fragen und 1 bis 10 Positionen.",
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

  const allowed = await guard(req, "script", 1);
  if (!allowed.ok) return errorResponse(allowed.error, allowed.status);

  const jobId = `e${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const startedAt = Date.now();

  await writeJson(quizEditJobPath(jobId), {
    jobId,
    kind: "requestion",
    status: "running",
    step: `${replace.length} ${replace.length === 1 ? "Frage wird" : "Fragen werden"} neu geschrieben`,
    startedAt,
    updatedAt: startedAt,
  } satisfies QuizEditJob);

  waitUntil(
    (async () => {
      try {
        // Best effort, like in the generator: losing the memory costs variety,
        // failing to read it would cost the rewrite.
        const history = await askedQuestions().catch(() => ({
          prompts: [] as string[],
          total: 0,
        }));

        const next = await rewriteQuestions({
          apiKey,
          model,
          topic,
          questions,
          replace,
          asked: history.prompts,
          availableFlags: questions.some((q) => q.flag)
            ? availableFlags()
            : undefined,
        });
        await writeJson(quizEditJobPath(jobId), {
          jobId,
          kind: "requestion",
          status: "done",
          questions: next,
          startedAt,
          updatedAt: Date.now(),
        } satisfies QuizEditJob);
      } catch (err) {
        await writeJson(quizEditJobPath(jobId), {
          jobId,
          kind: "requestion",
          status: "error",
          error: (err as Error).message.slice(0, 400),
          startedAt,
          updatedAt: Date.now(),
        } satisfies QuizEditJob).catch(() => undefined);
      }
    })(),
  );

  return Response.json({ jobId });
}

export async function GET(req: Request) {
  const jobId = new URL(req.url).searchParams.get("jobId");
  if (!jobId || !/^[a-zA-Z0-9_-]{6,64}$/.test(jobId)) {
    return errorResponse("Ungültige oder fehlende jobId.", 400);
  }

  const job = await readJson<QuizEditJob>(quizEditJobPath(jobId));
  if (!job) return errorResponse("Zu dieser jobId gibt es keinen Auftrag.", 404);

  if (
    job.status === "running" &&
    Date.now() - job.startedAt > (maxDuration + 30) * 1000
  ) {
    return Response.json({
      ...job,
      status: "error",
      error: "Der Auftrag hat das Zeitlimit überschritten.",
    } satisfies QuizEditJob);
  }

  return Response.json(job);
}
