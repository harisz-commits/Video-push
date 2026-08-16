import { readdirSync } from "fs";
import { join } from "path";
import { complete, type Turn } from "./llm";
import { narrateQuestions, narrationCost } from "./quiz-narration";
import { QuizProject, QuizQuestion } from "./quiz";
import {
  buildQuizPrompt,
  QUIZ_FRAME_SYSTEM_PROMPT,
  QUIZ_SYSTEM_PROMPT,
} from "./quiz-prompt";
import { costCents, resolveTextModel, type TextModel } from "./text-models";
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

/**
 * When narration must stop starting new recordings.
 *
 * The route is allowed 300 seconds and writing fifty questions already takes
 * a good part of that. Leaving forty seconds of headroom means the job always
 * gets to write its result — a quiz with some questions unread is usable, a
 * function killed mid-write leaves nothing at all.
 */
const NARRATION_DEADLINE_MS = 260_000;

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
  /** Which model writes the questions. See lib/text-models.ts. */
  model?: TextModel;
  /**
   * Read the questions aloud.
   *
   * Off unless asked for, and asked for at generation time rather than later,
   * because it is the one step here that spends a budget with a monthly
   * ceiling rather than a per-call price.
   */
  narrate?: { withReveal: boolean; voiceId: string; elevenKey: string };
  startedAt: number;
}): Promise<void> {
  const model = args.model ?? resolveTextModel();
  const flags = availableFlags();
  /** Tokens spent across every call this job made, for reporting the cost. */
  const spent = { input: 0, output: 0 };
  /** Set when narration failed but the quiz itself is fine. */
  let narrationError: string | undefined;

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
      model,
      apiKey: args.apiKey,
      spent,
      topic: args.topic,
      count: args.count,
      flags,
      onAttempt: (attempt) =>
        progress(
          attempt === 0
            ? `${args.count} Fragen werden geschrieben`
            : `Nachbessern (Versuch ${attempt + 1} von 3)`,
        ).then(() => undefined),
    });

    await progress("Titel und Einstieg");
    const frame = await writeFrame({
      model,
      apiKey: args.apiKey,
      spent,
      topic: args.topic,
      count: questions.length,
    });

    // Last, and only if asked. The questions are the expensive half in model
    // tokens and this is the expensive half in voice credits, so a failure
    // here must not throw away work that is already finished and paid for.
    let spoken = questions;
    if (args.narrate) {
      const options = { withReveal: args.narrate.withReveal };
      const plan = narrationCost(questions, options);
      try {
        const result = await narrateQuestions({
          jobId: args.jobId,
          questions,
          options,
          voiceId: args.narrate.voiceId,
          apiKey: args.narrate.elevenKey,
          deadline: args.startedAt + NARRATION_DEADLINE_MS,
          onProgress: (done, total) =>
            progress(
              `Fragen werden vorgelesen: Aufnahme ${done} von ${total}` +
                (total < questions.length
                  ? ` (${questions.length} Fragen, ${total} verschiedene Texte)`
                  : ""),
            ).then(() => undefined),
        });
        spoken = result.questions;
        if (result.skipped > 0) {
          narrationError = `Die Zeit reichte nicht für alle Aufnahmen: ${result.clips} von ${result.clips + result.skipped} Texten wurden vorgelesen, der Rest bleibt stumm. Das Video rendert trotzdem — nur diese Fragen laufen ohne Stimme.`;
        }
      } catch (err) {
        // A quiz without narration is a quiz. Losing thirty written questions
        // because the voice ran out of credits is not a trade worth making, so
        // the failure is carried into the finished project as a note rather
        // than thrown.
        narrationError = `Die Fragen konnten nicht vorgelesen werden (${(err as Error).message.slice(0, 160)}). Das Quiz ist fertig, nur ohne Stimme — geschätzt hätte es ${plan.characters.toLocaleString("de-DE")} Zeichen gekostet.`;
      }
    }

    const project = QuizProject.parse({
      kind: "quiz",
      id: `quiz-${args.jobId}`,
      topic: args.topic,
      title: frame.title,
      intro: frame.intro,
      outro: frame.outro,
      questions: spoken,
      fps: 30,
      width: 1920,
      height: 1080,
    });

    await writeJson(quizJobPath(args.jobId), {
      jobId: args.jobId,
      topic: args.topic,
      status: "done",
      project,
      // What this run actually cost, measured rather than estimated — the
      // studio shows it beside the finished quiz so the price on screen is
      // what happened, not what somebody guessed beforehand. Retries and the
      // title call are included; they were paid for too.
      cost: {
        model: model.id,
        label: model.label,
        inputTokens: spent.input,
        outputTokens: spent.output,
        cents: Number(costCents(model, spent).toFixed(3)),
      },
      // A done job that still has something to say. The studio shows it as a
      // warning beside a finished quiz rather than as a failure.
      warning: narrationError,
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
  model: TextModel;
  apiKey: string;
  spent: { input: number; output: number };
  topic: string;
  count: number;
  flags: string[];
  /** Reports each attempt, so a slow run does not look like a dead one. */
  onAttempt?: (attempt: number) => Promise<void>;
}): Promise<QuizQuestion[]> {
  const messages: Turn[] = [
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
    await args.onAttempt?.(attempt);
    const reply = await complete({
      model: args.model,
      apiKey: args.apiKey,
      system: QUIZ_SYSTEM_PROMPT,
      messages,
      // Scaled with the request. Thinking tokens count against this ceiling on
      // both providers, so a fixed 8000 was fine for twelve questions and
      // truncated thirty mid-JSON — and a reply cut off at the ceiling costs
      // the whole batch, not part of it.
      maxTokens: Math.min(32000, 6000 + args.count * 700),
      effort: (process.env.ANTHROPIC_EFFORT as "low" | "medium" | "high") ?? "medium",
    });

    // Counted even on an attempt that gets rejected below: a retry is spent
    // money whether or not its output survived.
    args.spent.input += reply.usage.input;
    args.spent.output += reply.usage.output;

    const raw = reply.text;
    if (reply.truncated) {
      throw new Error(
        `Die Antwort wurde beim Token-Limit abgeschnitten. Fordere weniger Fragen an (aktuell ${args.count}).`,
      );
    }

    const parsed = parseQuestions(raw, args.flags);
    if (parsed.ok) return balancePositions(interleaveLevels(parsed.questions));

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
 * Shuffle the difficulties together instead of climbing through them.
 *
 * A quiz sorted easy → impossible tells a viewer, somewhere around the middle,
 * that the rest is not for them — and they leave. Mixed, every hard question is
 * followed by one they might get, so there is always a reason to stay for the
 * next one.
 *
 * Done here as well as asked for in the prompt, because "mixed" is an
 * instruction a model follows loosely and an arrangement anyone can verify. It
 * takes whatever came back and lays it out so the same difficulty rarely lands
 * twice in a row, always picking from the level with the most questions left —
 * which spreads each of them across the whole video rather than clumping.
 */
function interleaveLevels(questions: QuizQuestion[]): QuizQuestion[] {
  const buckets = new Map<string, QuizQuestion[]>();
  for (const q of questions) {
    const list = buckets.get(q.level) ?? [];
    list.push(q);
    buckets.set(q.level, list);
  }

  const out: QuizQuestion[] = [];
  let previous: string | null = null;

  while (out.length < questions.length) {
    const candidates = [...buckets.entries()].filter(([, list]) => list.length > 0);
    if (candidates.length === 0) break;

    // Largest remaining pile first, but never the same level twice running
    // unless it is the only thing left.
    const usable = candidates.filter(([level]) => level !== previous);
    const pool = usable.length > 0 ? usable : candidates;
    pool.sort((a, b) => b[1].length - a[1].length);

    const [level, list] = pool[0];
    out.push(list.shift()!);
    previous = level;
  }

  // An easy one first: the opening question decides whether anybody plays at
  // all, and losing on question one is the fastest way to lose a viewer.
  const easiest = out.findIndex((q) => q.level === "easy");
  if (easiest > 0) {
    const [first] = out.splice(easiest, 1);
    out.unshift(first);
  }

  return out.map((q, i) => ({ ...q, id: `q${i + 1}` }));
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

  // Note what is NOT checked here: which slot the correct answer sits in.
  //
  // It used to be, and rejecting a batch over it was a mistake that cost far
  // more than the fault. `balancePositions` fixes the distribution exactly and
  // for free, so a complaint about it sent thirty questions back to be
  // rewritten in order to fix something already handled downstream — three
  // rounds of that is minutes of work and can outlive the function itself,
  // which is what "es steht schon lange Fragen werden geschrieben" looks like
  // from the outside.
  //
  // The rule: only reject what cannot be repaired here.

  return problems.length === 0
    ? { ok: true, questions }
    : { ok: false, problems: problems.slice(0, 12) };
}

async function writeFrame(args: {
  model: TextModel;
  apiKey: string;
  spent: { input: number; output: number };
  topic: string;
  count: number;
}): Promise<{ title: string; intro: string; outro: string }> {
  const reply = await complete({
    model: args.model,
    apiKey: args.apiKey,
    system: QUIZ_FRAME_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `Thema: ${args.topic}\nAnzahl Fragen: ${args.count}`,
      },
    ],
    // Small on purpose — three short lines. Google's thinking models will use
    // a chunk of this before writing anything, hence the headroom.
    maxTokens: 2000,
    effort: "low",
  });

  args.spent.input += reply.usage.input;
  args.spent.output += reply.usage.output;

  const json = extractJson(reply.text) as {
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
