import Anthropic from "@anthropic-ai/sdk";
import { readdirSync } from "fs";
import { join } from "path";
import { QuizProject, QuizQuestion } from "./quiz";
import {
  buildQuizPrompt,
  QUIZ_FRAME_SYSTEM_PROMPT,
  QUIZ_SYSTEM_PROMPT,
} from "./quiz-prompt";
import { quizJobPath, writeJson, type QuizJob } from "./store";

/**
 * Writing a quiz.
 *
 * Shorter than the script pipeline and deliberately not sharing it: there is no
 * research phase, no voiceover to fit and no scene segmentation, so the two
 * would have shared a name and nothing else.
 *
 * What it does have that the script pipeline does not is a hard check on the
 * output. A quiz answer is either right or it is a visible, permanent mistake,
 * so everything mechanically checkable gets checked — three answers, a valid
 * index, no duplicates, a flag file that actually exists — and the model is
 * told what it got wrong rather than being trusted the second time either.
 */

const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5";
const EFFORT = (process.env.ANTHROPIC_EFFORT as "low" | "medium" | "high") ?? "medium";

/**
 * Which flags are on disk.
 *
 * The model is given this list rather than trusted to remember ISO codes,
 * because a code that does not resolve is a blank rectangle where the question
 * should be — the one failure that cannot be noticed until the video is
 * rendered.
 */
export function availableFlags(): string[] {
  try {
    return readdirSync(join(process.cwd(), "public", "flags"))
      .filter((f) => f.endsWith(".svg"))
      .map((f) => f.replace(/\.svg$/, ""))
      .sort();
  } catch {
    return [];
  }
}

export async function generateQuiz(args: {
  jobId: string;
  topic: string;
  count: number;
  apiKey: string;
  startedAt: number;
}): Promise<void> {
  const client = new Anthropic({ apiKey: args.apiKey });
  const flags = availableFlags();

  const progress = (step: string) =>
    writeJson(quizJobPath(args.jobId), {
      jobId: args.jobId,
      topic: args.topic,
      status: "running",
      step,
      startedAt: args.startedAt,
      updatedAt: Date.now(),
    } satisfies QuizJob).catch(() => undefined);

  try {
    await progress("Fragen werden geschrieben");
    const questions = await writeQuestions({
      client,
      topic: args.topic,
      count: args.count,
      flags,
    });

    await progress("Titel und Einstieg");
    const frame = await writeFrame({ client, topic: args.topic, count: questions.length });

    const project = QuizProject.parse({
      kind: "quiz",
      id: `quiz-${args.jobId}`,
      topic: args.topic,
      title: frame.title,
      intro: frame.intro,
      outro: frame.outro,
      questions,
      fps: 30,
      width: 1920,
      height: 1080,
    });

    await writeJson(quizJobPath(args.jobId), {
      jobId: args.jobId,
      topic: args.topic,
      status: "done",
      project,
      startedAt: args.startedAt,
      updatedAt: Date.now(),
    } satisfies QuizJob);
  } catch (err) {
    await writeJson(quizJobPath(args.jobId), {
      jobId: args.jobId,
      topic: args.topic,
      status: "error",
      error: (err as Error).message.slice(0, 400),
      startedAt: args.startedAt,
      updatedAt: Date.now(),
    } satisfies QuizJob).catch(() => undefined);
  }
}

async function writeQuestions(args: {
  client: Anthropic;
  topic: string;
  count: number;
  flags: string[];
}): Promise<QuizQuestion[]> {
  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: buildQuizPrompt({
        topic: args.topic,
        count: args.count,
        // Only worth sending when the topic plausibly wants flags; the list is
        // 271 codes and costs tokens on every call that will never use it.
        availableFlags: /flagg|länder|country|flag/i.test(args.topic)
          ? args.flags
          : undefined,
      }),
    },
  ];

  for (let attempt = 0; attempt < 3; attempt++) {
    const message = await args.client.messages.create({
      model: MODEL,
      max_tokens: 8000,
      output_config: { effort: EFFORT },
      system: QUIZ_SYSTEM_PROMPT,
      messages,
    });

    if (message.stop_reason === "refusal") {
      throw new Error(
        "Das Modell hat dieses Thema abgelehnt. Formuliere es anders oder wähle ein anderes.",
      );
    }
    const raw = textOf(message);
    if (message.stop_reason === "max_tokens") {
      throw new Error(
        `Die Antwort wurde beim Token-Limit abgeschnitten. Fordere weniger Fragen an (aktuell ${args.count}).`,
      );
    }

    const parsed = parseQuestions(raw, args.flags);
    if (parsed.ok) return balancePositions(parsed.questions);

    if (attempt === 2) {
      throw new Error(
        `Die Fragen ließen sich auch nach drei Versuchen nicht validieren: ${parsed.problems.join("; ")}`,
      );
    }

    // Hand the complaints back rather than starting over: the model keeps the
    // questions that were fine and fixes the ones named.
    messages.push({ role: "assistant", content: raw.slice(0, 12000) });
    messages.push({
      role: "user",
      content: `Diese Probleme müssen behoben werden:\n${parsed.problems
        .map((p) => `- ${p}`)
        .join("\n")}\n\nAntworte erneut mit dem vollständigen JSON-Objekt.`,
    });
  }

  throw new Error("Unerreichbar.");
}

/**
 * Move the correct answer so A, B and C each win about a third of the time.
 *
 * Asking the model to spread them out mostly works and is not worth relying on
 * — a real generation came back 7/4/1, which is under any threshold loose
 * enough to avoid pointless retries and still obvious to anyone watching. It
 * is also a pure permutation of three strings, so there is no reason to spend
 * a model round-trip on it: rotating each question's answers into an assigned
 * slot is exact, free, and cannot fail.
 *
 * The assignment is round-robin over a rotating start, so the positions do not
 * fall into a visible A-B-C-A-B-C rhythm either.
 */
function balancePositions(questions: QuizQuestion[]): QuizQuestion[] {
  // Deterministic from the content, so regenerating the same quiz twice gives
  // the same video rather than a gratuitously different one.
  const seedText = questions.map((q) => q.id + q.prompt).join("");
  let seed = 0;
  for (let i = 0; i < seedText.length; i++) {
    seed = (seed * 31 + seedText.charCodeAt(i)) >>> 0;
  }

  const targets = questions.map((_, i) => (i + (seed % 3)) % 3);
  // A plain rotation would put the answer in the same place every third
  // question; nudging every fourth one breaks the pattern without unbalancing.
  for (let i = 3; i < targets.length; i += 4) {
    targets[i] = (targets[i] + 1) % 3;
  }

  return questions.map((q, i) => {
    const target = targets[i];
    if (target === q.correctIndex) return q;
    const answers = [...q.answers];
    [answers[target], answers[q.correctIndex]] = [
      answers[q.correctIndex],
      answers[target],
    ];
    return { ...q, answers, correctIndex: target };
  });
}

type ParseResult =
  | { ok: true; questions: QuizQuestion[] }
  | { ok: false; problems: string[] };

function parseQuestions(raw: string, flags: string[]): ParseResult {
  const json = extractJson(raw);
  if (!json) {
    return {
      ok: false,
      problems: [
        `Die Antwort enthielt kein JSON-Objekt (begann mit ${JSON.stringify(raw.slice(0, 120))}).`,
      ],
    };
  }

  const list = (json as { questions?: unknown }).questions;
  if (!Array.isArray(list)) {
    return { ok: false, problems: ['Das Feld "questions" fehlt oder ist keine Liste.'] };
  }

  const problems: string[] = [];
  const questions: QuizQuestion[] = [];
  const flagSet = new Set(flags);
  const seenPrompts = new Set<string>();

  list.forEach((item, i) => {
    const label = `Frage ${i + 1}`;
    const parsed = QuizQuestion.safeParse(item);
    if (!parsed.success) {
      problems.push(
        `${label}: ${parsed.error.issues.map((x) => `${x.path.join(".")} ${x.message}`).join(", ")}`,
      );
      return;
    }
    const q = parsed.data;

    // Everything below is checkable without knowing anything about the topic,
    // which is exactly why it is checked here instead of being asked for nicely.
    const answers = q.answers.map((a) => a.trim().toLowerCase());
    if (new Set(answers).size !== 3) {
      problems.push(`${label}: zwei Antwortmöglichkeiten sind identisch.`);
    }
    if (q.flag && !flagSet.has(q.flag)) {
      problems.push(
        `${label}: für den Flaggen-Code "${q.flag}" gibt es keine Datei. Nur vorhandene Codes verwenden.`,
      );
    }
    const key = q.prompt.trim().toLowerCase() + "|" + answers[q.correctIndex];
    if (seenPrompts.has(key)) {
      problems.push(`${label}: diese Frage kam schon einmal vor.`);
    }
    seenPrompts.add(key);

    questions.push(q);
  });

  if (questions.length === 0) {
    problems.push("Es kam keine einzige gültige Frage zurück.");
  }

  // The correct answer sitting in the same slot every time is a giveaway a
  // viewer notices within three questions, and the model does drift into it.
  if (questions.length >= 6) {
    const counts = [0, 0, 0];
    for (const q of questions) counts[q.correctIndex] += 1;
    const worst = Math.max(...counts);
    if (worst > questions.length * 0.6) {
      problems.push(
        `Die richtige Antwort steht ${worst} von ${questions.length} Mal an derselben Position. Gleichmäßiger auf A, B und C verteilen.`,
      );
    }
  }

  return problems.length === 0
    ? { ok: true, questions }
    : { ok: false, problems: problems.slice(0, 12) };
}

async function writeFrame(args: {
  client: Anthropic;
  topic: string;
  count: number;
}): Promise<{ title: string; intro: string; outro: string }> {
  const message = await args.client.messages.create({
    model: MODEL,
    max_tokens: 700,
    output_config: { effort: "low" },
    system: QUIZ_FRAME_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `Thema: ${args.topic}\nAnzahl Fragen: ${args.count}`,
      },
    ],
  });

  const json = extractJson(textOf(message)) as {
    title?: string;
    intro?: string;
    outro?: string;
  } | null;

  // A missing frame is not worth failing a whole quiz over — the questions are
  // the expensive part, and these three lines have obvious fallbacks.
  return {
    title: json?.title?.slice(0, 60) || `${args.topic}: ${args.count} Fragen`,
    intro:
      json?.intro?.slice(0, 200) ||
      `${args.count} Fragen. Ein paar Sekunden pro Frage. Wie weit kommst du?`,
    outro: json?.outro?.slice(0, 200) || "Wie viele hattest du? Schreib es in die Kommentare.",
  };
}

function textOf(message: Anthropic.Message): string {
  return message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}

/** The first balanced {...} in the reply, tolerating prose around it. */
function extractJson(raw: string): unknown {
  const start = raw.indexOf("{");
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < raw.length; i++) {
    const c = raw[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === "{") depth += 1;
    else if (c === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(raw.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}
