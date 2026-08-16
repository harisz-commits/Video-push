import { complete } from "./llm";
import { QuizQuestion } from "./quiz";
import { QUIZ_SYSTEM_PROMPT } from "./quiz-prompt";
import { resolveTextModel, type TextModel } from "./text-models";

/**
 * Replacing individual questions.
 *
 * The case this exists for: twenty-nine good questions and one that is wrong,
 * boring, or a near-duplicate of another. Regenerating the whole quiz to fix
 * one of them throws away twenty-nine good ones and costs a full run, and
 * editing it by hand means writing three plausible wrong answers yourself.
 *
 * What matters here is what the model is told NOT to write. It gets every
 * prompt already in the quiz — including the ones being replaced — because the
 * commonest failure is a replacement that duplicates a question two rows
 * further down, and the second commonest is getting the same question back
 * again.
 */

export async function rewriteQuestions(args: {
  apiKey: string;
  /** Which model rewrites them. Defaults to the studio's default. */
  model?: TextModel;
  topic: string;
  /** The whole quiz, so the replacements can avoid all of it. */
  questions: QuizQuestion[];
  /** Positions to replace. */
  replace: number[];
  availableFlags?: string[];
}): Promise<QuizQuestion[]> {
  const model = args.model ?? resolveTextModel();
  const wanted = args.replace.length;

  // Keeping the level means the difficulty mix the quiz was built with
  // survives the edit. Replacing an "impossible" with an "easy" would quietly
  // flatten a curve somebody arranged on purpose.
  const spec = args.replace
    .map((i, n) => `${n + 1}. Schwierigkeit "${args.questions[i].level}"`)
    .join("\n");

  const avoid = args.questions
    .map((q) => `- ${q.prompt} (Antwort: ${q.answers[q.correctIndex]})`)
    .join("\n");

  const flags = args.availableFlags?.length
    ? `\n\nVerfügbare Flaggen-Codes (nur diese verwenden):\n${args.availableFlags.join(" ")}`
    : "";

  const reply = await complete({
    model,
    apiKey: args.apiKey,
    maxTokens: Math.min(16000, 2000 + wanted * 700),
    effort: "medium",
    system: QUIZ_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `Thema: ${args.topic}

Schreib genau ${wanted} NEUE Fragen, in dieser Reihenfolge und mit diesen
Schwierigkeiten:
${spec}

Diese Fragen stehen bereits im Quiz. Keine davon darf noch einmal vorkommen,
auch nicht anders formuliert, und auch keine, die dieselbe Antwort abfragt:
${avoid}

Vergib die ids n1, n2, n3 …${flags}`,
      },
    ],
  });

  const raw = reply.text;

  if (reply.truncated) {
    throw new Error(
      "Die Antwort wurde beim Token-Limit abgeschnitten. Ersetze weniger Fragen auf einmal.",
    );
  }

  const fresh = parse(raw, args.availableFlags);
  if (fresh.length < wanted) {
    throw new Error(
      `Es kamen nur ${fresh.length} von ${wanted} brauchbaren Fragen zurück. Versuch es noch einmal.`,
    );
  }

  const out = [...args.questions];
  args.replace.forEach((position, n) => {
    const replacement = fresh[n];
    out[position] = {
      ...replacement,
      // The id belongs to the slot, not to the question — everything else in
      // the project refers to questions by position, and a renumbered list
      // would be a different quiz.
      id: args.questions[position].id,
      level: args.questions[position].level,
      // A replaced question is a new question, so any recording of the old one
      // is now a recording of something else entirely. Dropping it is the only
      // safe answer; the studio can offer to speak the new one.
      audioUrl: undefined,
      audioSeconds: undefined,
      // Spread the correct answer the same way the full generator does.
      ...place(replacement, position),
    };
  });
  return out;
}

/** Put the correct answer in the slot this position should have. */
function place(
  question: QuizQuestion,
  position: number,
): { answers: string[]; correctIndex: number } {
  const target = position % 3;
  if (target === question.correctIndex) {
    return { answers: question.answers, correctIndex: question.correctIndex };
  }
  const answers = [...question.answers];
  [answers[target], answers[question.correctIndex]] = [
    answers[question.correctIndex],
    answers[target],
  ];
  return { answers, correctIndex: target };
}

function parse(raw: string, flags?: string[]): QuizQuestion[] {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error("Die Antwort enthielt kein JSON-Objekt.");
  }

  let json: { questions?: unknown };
  try {
    json = JSON.parse(raw.slice(start, end + 1)) as { questions?: unknown };
  } catch {
    throw new Error("Die Antwort war kein gültiges JSON.");
  }

  const list = Array.isArray(json.questions) ? json.questions : [];
  const flagSet = flags ? new Set(flags) : null;

  return list
    .map((item) => QuizQuestion.safeParse(item))
    .filter((r): r is { success: true; data: QuizQuestion } => r.success)
    .map((r) => r.data)
    .filter((q) => new Set(q.answers.map((a) => a.trim().toLowerCase())).size === 3)
    // A flag code with no file behind it is a blank rectangle in the finished
    // video, which is the one fault that cannot be seen before rendering.
    .filter((q) => !q.flag || !flagSet || flagSet.has(q.flag));
}
