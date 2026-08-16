import { waitUntil } from "@vercel/functions";
import { errorResponse, guard } from "../../../../lib/guardrails";
import { QuizQuestion } from "../../../../lib/quiz";
import { narrateQuestions, narrationCost } from "../../../../lib/quiz-narration";
import {
  quizEditJobPath,
  readJson,
  writeJson,
  type QuizEditJob,
} from "../../../../lib/store";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Give an existing quiz a voice.
 *
 * The same work the generator can do in one pass, available afterwards —
 * because deciding whether a quiz is worth speaking is a decision you can only
 * make once you have read the questions. Doing it here also means a quiz whose
 * questions were rewritten can be re-spoken without regenerating anything.
 */
export async function POST(req: Request) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const voiceId = process.env.ELEVENLABS_VOICE_ID;
  if (!apiKey || !voiceId) {
    return errorResponse(
      "Vorlesen braucht ELEVENLABS_API_KEY und ELEVENLABS_VOICE_ID.",
      500,
    );
  }

  let questions: QuizQuestion[];
  let withAnswers = false;
  try {
    const body = (await req.json()) as {
      questions?: unknown;
      withAnswers?: unknown;
    };
    const parsed = QuizQuestion.array().safeParse(body.questions);
    if (!parsed.success || parsed.data.length === 0) throw new Error("questions");
    questions = parsed.data;
    withAnswers = body.withAnswers === true;
  } catch {
    return errorResponse("Ungültige Anfrage. Erwartet werden die Fragen.", 400);
  }

  // Counted against the voice budget, because that is what it spends.
  const allowed = await guard(req, "voice", 1);
  if (!allowed.ok) return errorResponse(allowed.error, allowed.status);

  const jobId = `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const startedAt = Date.now();
  const plan = narrationCost(questions, { withAnswers });

  await writeJson(quizEditJobPath(jobId), {
    jobId,
    kind: "narrate",
    status: "running",
    step: `${plan.unique} ${plan.unique === 1 ? "Aufnahme" : "Aufnahmen"} für ${questions.length} Fragen`,
    startedAt,
    updatedAt: startedAt,
  } satisfies QuizEditJob);

  waitUntil(
    (async () => {
      try {
        const result = await narrateQuestions({
          jobId,
          questions,
          withAnswers,
          voiceId,
          apiKey,
          // Forty seconds of headroom, so the job always gets to write its
          // result even if the recordings run long.
          deadline: startedAt + (maxDuration - 40) * 1000,
          onProgress: async (done, total) => {
            await writeJson(quizEditJobPath(jobId), {
              jobId,
              kind: "narrate",
              status: "running",
              step: `Aufnahme ${done} von ${total}`,
              startedAt,
              updatedAt: Date.now(),
            } satisfies QuizEditJob).catch(() => undefined);
          },
        });

        await writeJson(quizEditJobPath(jobId), {
          jobId,
          kind: "narrate",
          status: "done",
          questions: result.questions,
          warning:
            result.skipped > 0
              ? `Die Zeit reichte nicht für alle Aufnahmen: ${result.clips} von ${result.clips + result.skipped} Texten wurden gesprochen. Drück noch einmal auf Vertonen — was schon vertont ist, wird nicht erneut bezahlt.`
              : undefined,
          startedAt,
          updatedAt: Date.now(),
        } satisfies QuizEditJob);
      } catch (err) {
        await writeJson(quizEditJobPath(jobId), {
          jobId,
          kind: "narrate",
          status: "error",
          error: (err as Error).message.slice(0, 400),
          startedAt,
          updatedAt: Date.now(),
        } satisfies QuizEditJob).catch(() => undefined);
      }
    })(),
  );

  return Response.json({ jobId, characters: plan.characters, clips: plan.unique });
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
