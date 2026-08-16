import { synthesizeWithTimestamps } from "./elevenlabs";
import type { QuizQuestion } from "./quiz";
import { writeBinary } from "./store";

/**
 * Reading the questions aloud.
 *
 * Distinct from the language quiz, where the recording IS the question. Here
 * the recording only reads what is already on screen, which is why the flag
 * stays visible and why the timer treats the clip as a floor rather than as
 * the point.
 *
 * The whole design of this module is one observation: in a flag quiz the
 * prompt is the same hundred times over. "Welches Land ist das?" is twenty-one
 * characters, and synthesising it once instead of a hundred times is the
 * difference between twenty-one credits and six thousand. Everything else here
 * follows from wanting that saving to be automatic rather than something
 * anyone has to remember.
 */

/** What a question sounds like when read out. */
export function narrationText(
  question: QuizQuestion,
  options: { withAnswers: boolean },
): string {
  if (!options.withAnswers) return question.prompt;
  // "A: … B: … C: …" rather than a bare list, because three nouns read without
  // labels run together into one sentence and the viewer cannot tell which
  // option is which when they come to answer.
  const labelled = question.answers
    .map((answer, i) => `${"ABC"[i]}: ${answer}`)
    .join(". ");
  return `${question.prompt} ${labelled}.`;
}

/** Whether a question already carries a recording of exactly these words. */
export function isSpoken(
  question: QuizQuestion,
  options: { withAnswers: boolean },
): boolean {
  return Boolean(
    question.audioUrl &&
      question.audioText === narrationText(question, options),
  );
}

/**
 * What this will cost, before anything is spent.
 *
 * Counts only what would actually be sent: identical texts once, and nothing
 * for a question that already has a recording of exactly these words.
 */
export function narrationCost(
  questions: QuizQuestion[],
  options: { withAnswers: boolean },
): { characters: number; unique: number; saved: number } {
  const texts = questions.map((q) => narrationText(q, options));
  const already = new Set(
    questions.filter((q) => isSpoken(q, options)).map((q) => narrationText(q, options)),
  );
  const unique = new Set(texts.filter((t) => !already.has(t)));
  const characters = [...unique].reduce((sum, t) => sum + t.length, 0);
  const all = texts.reduce((sum, t) => sum + t.length, 0);
  return { characters, unique: unique.size, saved: all - characters };
}

export type NarrationResult = {
  questions: QuizQuestion[];
  /** Characters actually sent to ElevenLabs, for reporting after the fact. */
  characters: number;
  clips: number;
  /** Clips not made because the function ran out of time. */
  skipped: number;
};

/**
 * How many recordings to make at once.
 *
 * Two, not one, because fifty separate questions at a second and a half each
 * is most of the function's lifetime; and two, not ten, because the lower
 * ElevenLabs tiers cap concurrent requests and a 429 here costs a clip rather
 * than delaying one.
 */
const LANES = 2;

/**
 * Give every question a recording of itself.
 *
 * Identical texts share one clip: synthesised once, stored once, referenced by
 * every question that says the same thing. Two questions reading the same
 * words would also have produced two slightly different takes, so this is
 * steadier as well as cheaper.
 */
export async function narrateQuestions(args: {
  jobId: string;
  questions: QuizQuestion[];
  withAnswers: boolean;
  voiceId: string;
  apiKey: string;
  /**
   * When to stop starting new recordings, as an epoch time.
   *
   * Fifty distinct questions can outlast the function that is making them, and
   * being killed half way through would lose every clip along with the written
   * questions. Stopping early instead leaves a quiz where some questions are
   * read and the rest are not — which renders perfectly, because the timing
   * rule is per question.
   */
  deadline?: number;
  /** Reports progress in clips, not questions — they differ, often by a lot. */
  onProgress?: (done: number, total: number) => Promise<void>;
}): Promise<NarrationResult> {
  const texts = args.questions.map((q) =>
    narrationText(q, { withAnswers: args.withAnswers }),
  );

  // Recordings that already exist and still say the right thing. Reusing them
  // is what makes "speak the ones that have no voice yet" cost only those —
  // the case after a few questions have been rewritten.
  const clips = new Map<string, { url: string; seconds?: number }>();
  for (const [i, question] of args.questions.entries()) {
    if (isSpoken(question, { withAnswers: args.withAnswers })) {
      clips.set(texts[i], {
        url: question.audioUrl!,
        seconds: question.audioSeconds,
      });
    }
  }

  const distinct = [...new Set(texts)].filter((t) => !clips.has(t));
  let characters = 0;
  let done = 0;
  let skipped = 0;
  let next = 0;

  const lane = async () => {
    for (;;) {
      const index = next++;
      if (index >= distinct.length) return;

      if (args.deadline && Date.now() > args.deadline) {
        skipped += 1;
        continue;
      }

      const text = distinct[index];
      const { audio, alignment } = await synthesizeWithTimestamps({
        text,
        voiceId: args.voiceId,
        apiKey: args.apiKey,
      });
      characters += text.length;

      // Keyed by position in the distinct list rather than by the text, because
      // the text is a filename here and German questions are full of characters
      // a key cannot carry.
      const url = await writeBinary(
        `audio/ask-${args.jobId}-${index}.mp3`,
        audio,
        "audio/mpeg",
      );

      const ends = alignment.endTimesSeconds;
      clips.set(text, {
        url,
        seconds: ends.length ? ends[ends.length - 1] : undefined,
      });

      done += 1;
      await args.onProgress?.(done, distinct.length);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(LANES, distinct.length) }, lane),
  );

  return {
    questions: args.questions.map((question, i) => {
      const clip = clips.get(texts[i]);
      return clip
        ? {
            ...question,
            audioUrl: clip.url,
            audioSeconds: clip.seconds,
            audioText: texts[i],
          }
        : question;
    }),
    characters,
    clips: clips.size,
    skipped,
  };
}
