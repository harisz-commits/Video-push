import { waitUntil } from "@vercel/functions";
import { errorResponse, guard } from "../../../../lib/guardrails";
import {
  DEFAULT_SAMPLE,
  generateLanguageQuiz,
  type LanguagePick,
} from "../../../../lib/quiz-language";
import { quizJobPath, writeJson, type QuizJob } from "../../../../lib/store";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Start a language quiz.
 *
 * Polled through the same GET as the general one — a job is a job, and having
 * two shapes of progress for two kinds of quiz would only mean two things for
 * the studio to get wrong.
 */
export async function POST(req: Request) {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const elevenKey = process.env.ELEVENLABS_API_KEY;
  const voiceId = process.env.ELEVENLABS_VOICE_ID;

  if (!anthropicKey) return errorResponse("ANTHROPIC_API_KEY ist nicht gesetzt.", 500);
  if (!elevenKey) return errorResponse("ELEVENLABS_API_KEY ist nicht gesetzt.", 500);
  if (!voiceId) {
    return errorResponse(
      "ELEVENLABS_VOICE_ID ist nicht gesetzt — ohne Stimme kann keine Sprachaufnahme entstehen.",
      500,
    );
  }

  let languages: LanguagePick[];
  let sentence: string;
  try {
    const body = (await req.json()) as {
      languages?: unknown;
      sentence?: unknown;
    };
    if (!Array.isArray(body.languages) || body.languages.length < 3) {
      throw new Error("languages");
    }
    languages = body.languages
      .filter(
        (l): l is LanguagePick =>
          typeof l === "object" &&
          l !== null &&
          typeof (l as LanguagePick).id === "string" &&
          typeof (l as LanguagePick).name === "string",
      )
      // Twelve is about four minutes of clips and the point at which a viewer
      // stops being able to hold the options in their head.
      .slice(0, 12);
    if (languages.length < 3) throw new Error("languages");

    sentence =
      typeof body.sentence === "string" && body.sentence.trim().length >= 20
        ? body.sentence.trim().slice(0, 400)
        : DEFAULT_SAMPLE;
  } catch {
    return errorResponse(
      "Ungültige Anfrage. Erwartet werden mindestens drei Sprachen.",
      400,
    );
  }

  // Counted against the voice budget rather than the script one: this spends
  // ElevenLabs characters, once per language.
  const allowed = await guard(req, "voice", languages.length);
  if (!allowed.ok) return errorResponse(allowed.error, allowed.status);

  const jobId = `q${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const startedAt = Date.now();

  await writeJson(quizJobPath(jobId), {
    jobId,
    topic: "Sprachen erraten",
    status: "running",
    startedAt,
    updatedAt: startedAt,
  } satisfies QuizJob);

  waitUntil(
    generateLanguageQuiz({
      jobId,
      languages,
      sentence,
      voiceId,
      anthropicKey,
      elevenKey,
      startedAt,
    }),
  );

  return Response.json({ jobId });
}
