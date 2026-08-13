import Anthropic from "@anthropic-ai/sdk";
import { synthesizeWithTimestamps } from "./elevenlabs";
import { QuizProject, QuizQuestion } from "./quiz";
import { quizJobPath, writeBinary, writeJson, type QuizJob } from "./store";

/**
 * The language quiz.
 *
 * A different question entirely from the general one: there is nothing to
 * read and nothing to look at. A voice says a sentence, and the viewer names
 * the language. That makes the recording the question rather than an
 * accompaniment, which is why the timer waits for it and why no flag is ever
 * shown — a flag beside a spoken sentence answers the question before it is
 * asked.
 *
 * The same sentence is used in every language on purpose. Different sentences
 * would let a viewer guess from length or rhythm instead of from the language,
 * and the point is to test the ear.
 */

const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5";

/** What is said, unless someone changes it. Everyday, neutral, unmistakably ordinary. */
export const DEFAULT_SAMPLE =
  "Heute ist ein schöner Tag. Ich denke, ich werde spazieren gehen und etwas Zeit an der frischen Luft verbringen.";

const TRANSLATE_SYSTEM = `Du übersetzt einen Satz in mehrere Sprachen.

- Übersetze den Satz sinngemäß, nicht Wort für Wort. Er soll klingen, wie ein
  Muttersprachler ihn sagen würde.
- Gleiche Länge und gleicher Inhalt in allen Sprachen: der Satz wird vorgelesen
  und die Zuhörer sollen die Sprache erkennen, nicht die Satzlänge vergleichen.
- Schreib in der Schrift der Sprache (Japanisch in japanischer Schrift, Arabisch
  in arabischer Schrift). Keine Umschrift.
- Keine Erklärungen, keine Klammern, keine Aussprachehilfen.

Antworte mit einem JSON-Objekt, sonst nichts:
{"translations":{"<sprach-id>":"<Übersetzung>", …}}`;

export type LanguagePick = { id: string; name: string };

export async function generateLanguageQuiz(args: {
  jobId: string;
  languages: LanguagePick[];
  sentence: string;
  voiceId: string;
  anthropicKey: string;
  elevenKey: string;
  startedAt: number;
}): Promise<void> {
  const progress = (step: string) =>
    writeJson(quizJobPath(args.jobId), {
      jobId: args.jobId,
      topic: "Sprachen erraten",
      status: "running",
      step,
      startedAt: args.startedAt,
      updatedAt: Date.now(),
    } satisfies QuizJob).catch(() => undefined);

  try {
    await progress(`${args.languages.length} Sprachen werden übersetzt`);
    const translations = await translate({
      client: new Anthropic({ apiKey: args.anthropicKey }),
      sentence: args.sentence,
      languages: args.languages,
    });

    const questions: QuizQuestion[] = [];
    for (const [index, language] of args.languages.entries()) {
      const text = translations[language.id];
      if (!text) continue;

      await progress(
        `Aufnahme ${index + 1} von ${args.languages.length}: ${language.name}`,
      );

      // One request per language rather than one long one: they are separate
      // clips in the finished video, and a single failure should cost one
      // question rather than the whole quiz.
      const { audio, alignment } = await synthesizeWithTimestamps({
        text,
        voiceId: args.voiceId,
        apiKey: args.elevenKey,
      });

      const url = await writeBinary(
        `audio/lang-${args.jobId}-${language.id}.mp3`,
        audio,
        "audio/mpeg",
      );
      const ends = alignment.endTimesSeconds;
      const seconds = ends.length ? ends[ends.length - 1] : undefined;

      questions.push({
        id: `q${questions.length + 1}`,
        // Every question is the same difficulty here — there is no scale to
        // climb when each one is a different language, and pretending
        // otherwise would only colour the screen at random.
        level: "medium",
        prompt: "Welche Sprache ist das?",
        answers: options(language, args.languages),
        correctIndex: 0,
        thinkSeconds: 5,
        hype: "Hör genau hin!",
        audioUrl: url,
        audioSeconds: seconds,
      });
    }

    if (questions.length === 0) {
      throw new Error(
        "Es kam keine einzige Übersetzung zurück, die sich sprechen ließ.",
      );
    }

    const project = QuizProject.parse({
      kind: "quiz",
      mode: "language",
      id: `quiz-${args.jobId}`,
      topic: "Sprachen erraten",
      title: "Errätst du diese Sprachen?",
      intro: `${questions.length} Sprachen. Hör hin und rate mit.`,
      outro:
        "Vielen Dank fürs Zuschauen — abonniere den Kanal, wenn du ein wahrer Sprachprofi bist!",
      showAnswers: true,
      questions: balance(questions),
      fps: 30,
      width: 1920,
      height: 1080,
    });

    await writeJson(quizJobPath(args.jobId), {
      jobId: args.jobId,
      topic: "Sprachen erraten",
      status: "done",
      project,
      startedAt: args.startedAt,
      updatedAt: Date.now(),
    } satisfies QuizJob);
  } catch (err) {
    await writeJson(quizJobPath(args.jobId), {
      jobId: args.jobId,
      topic: "Sprachen erraten",
      status: "error",
      error: (err as Error).message.slice(0, 400),
      startedAt: args.startedAt,
      updatedAt: Date.now(),
    } satisfies QuizJob).catch(() => undefined);
  }
}

/**
 * Three options: the language spoken, and two others from the same set.
 *
 * Drawn from the languages actually in this video rather than from the whole
 * catalogue, so every wrong answer is one the viewer will hear at some point —
 * which makes elimination a real strategy instead of a guess between one
 * familiar name and two they have never seen.
 */
function options(correct: LanguagePick, pool: LanguagePick[]): string[] {
  const others = pool.filter((l) => l.id !== correct.id).map((l) => l.name);
  // Deterministic from the language id, so regenerating the same quiz does not
  // reshuffle the distractors for no reason.
  let seed = 0;
  for (const ch of correct.id) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;

  const picked: string[] = [];
  for (let i = 0; i < 2 && others.length > 0; i++) {
    const at = (seed + i * 7) % others.length;
    picked.push(others.splice(at, 1)[0]);
  }
  while (picked.length < 2) picked.push("Unbekannt");

  return [correct.name, ...picked];
}

/** Spread the correct answer across the three slots. Same trick as the general quiz. */
function balance(questions: QuizQuestion[]): QuizQuestion[] {
  return questions.map((q, i) => {
    const target = i % 3;
    if (target === q.correctIndex) return q;
    const answers = [...q.answers];
    [answers[target], answers[q.correctIndex]] = [
      answers[q.correctIndex],
      answers[target],
    ];
    return { ...q, answers, correctIndex: target };
  });
}

async function translate(args: {
  client: Anthropic;
  sentence: string;
  languages: LanguagePick[];
}): Promise<Record<string, string>> {
  const list = args.languages
    .map((l) => `${l.id} = ${l.name}`)
    .join("\n");

  const message = await args.client.messages.create({
    model: MODEL,
    max_tokens: 4000,
    output_config: { effort: "low" },
    system: TRANSLATE_SYSTEM,
    messages: [
      {
        role: "user",
        content: `Satz:\n${args.sentence}\n\nSprachen (Id = Name):\n${list}\n\nGib für jede Id die Übersetzung an.`,
      },
    ],
  });

  const raw = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error("Die Übersetzung kam nicht als JSON zurück.");
  }

  const parsed = JSON.parse(raw.slice(start, end + 1)) as {
    translations?: Record<string, string>;
  };
  const translations = parsed.translations ?? {};

  const missing = args.languages.filter((l) => !translations[l.id]);
  if (missing.length === args.languages.length) {
    throw new Error("Keine der angeforderten Sprachen kam zurück.");
  }
  return translations;
}
