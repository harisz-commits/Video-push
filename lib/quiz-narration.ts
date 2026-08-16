import { synthesizeWithTimestamps } from "./elevenlabs";
import type { QuizQuestion } from "./quiz";
import { writeBinary } from "./store";

/**
 * Reading a quiz aloud.
 *
 * Two different lines, spoken at two different moments:
 *
 *   - the question, while the clock runs. Distinct from the language quiz,
 *     where the recording IS the question — here it only reads what is already
 *     on screen, which is why the flag stays visible and why the timer treats
 *     the clip as a floor rather than as the point.
 *
 *   - the answer, once the time is up. Read at the reveal, not appended to the
 *     question: saying "richtig ist Japan" while the viewer is still supposed
 *     to be guessing would give the game away, and reading the three options
 *     aloud — which this used to offer — helps nobody, because the options are
 *     large on screen and hearing them listed is slower than reading them.
 *
 * The other thing this module is built around: in a flag quiz the prompt is
 * the same fifty times over. "Welches Land ist das?" is twenty-one characters,
 * and synthesising it once instead of fifty times is the difference between
 * twenty-one credits and a thousand. Identical texts are therefore always
 * shared — which is why the question half is nearly free and the answer half,
 * where every line differs, is not.
 */

export type NarrationOptions = {
  /** Also speak the correct answer when the timer runs out. */
  withReveal: boolean;
};

/** What a question sounds like while the clock runs. */
export function narrationText(question: QuizQuestion): string {
  return question.prompt;
}

/** What is said once the time is up. */
export function revealText(question: QuizQuestion): string {
  return `Richtig ist: ${question.answers[question.correctIndex]}.`;
}

/** Whether a question already carries a recording of exactly these words. */
export function isSpoken(question: QuizQuestion): boolean {
  return Boolean(
    question.audioUrl && question.audioText === narrationText(question),
  );
}

/** Whether the answer is already recorded, and still says the right name. */
export function isRevealSpoken(question: QuizQuestion): boolean {
  return Boolean(
    question.revealAudioUrl && question.revealAudioText === revealText(question),
  );
}

/**
 * What this will cost, before anything is spent.
 *
 * Counts only what would actually be sent: identical texts once, and nothing
 * for a line that already has a recording saying exactly those words.
 */
export function narrationCost(
  questions: QuizQuestion[],
  options: NarrationOptions,
): { characters: number; unique: number } {
  const wanted = plan(questions, options).filter((j) => !j.done);
  const unique = new Set(wanted.map((j) => j.text));
  return {
    characters: [...unique].reduce((sum, t) => sum + t.length, 0),
    unique: unique.size,
  };
}

type Job = { text: string; done: boolean };

/** Every line this quiz wants spoken, and whether it already is. */
function plan(questions: QuizQuestion[], options: NarrationOptions): Job[] {
  const jobs: Job[] = questions.map((q) => ({
    text: narrationText(q),
    done: isSpoken(q),
  }));
  if (options.withReveal) {
    for (const q of questions) {
      jobs.push({ text: revealText(q), done: isRevealSpoken(q) });
    }
  }
  return jobs;
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
 * Two, not one, because fifty separate lines at a second and a half each is
 * most of the function's lifetime; and two, not ten, because the lower
 * ElevenLabs tiers cap concurrent requests and a 429 here costs a clip rather
 * than delaying one.
 */
const LANES = 2;

type Clip = { url: string; seconds?: number };

/**
 * Give the quiz its voice.
 *
 * Identical texts share one clip: synthesised once, stored once, referenced by
 * every line that says the same thing. Two questions reading the same words
 * would also have produced two slightly different takes, so this is steadier
 * as well as cheaper.
 */
export async function narrateQuestions(args: {
  jobId: string;
  questions: QuizQuestion[];
  options: NarrationOptions;
  voiceId: string;
  apiKey: string;
  /**
   * When to stop starting new recordings, as an epoch time.
   *
   * Fifty distinct lines can outlast the function that is making them, and
   * being killed half way through would lose every clip along with the written
   * questions. Stopping early instead leaves a quiz where some lines are
   * spoken and the rest are not — which renders perfectly, because the timing
   * rule is per question.
   */
  deadline?: number;
  /** Reports progress in clips, not questions — they differ, often by a lot. */
  onProgress?: (done: number, total: number) => Promise<void>;
}): Promise<NarrationResult> {
  // Recordings that already exist and still say the right thing. Reusing them
  // is what makes "speak the lines that have no voice yet" cost only those —
  // the case after a few questions have been rewritten.
  const clips = new Map<string, Clip>();
  for (const q of args.questions) {
    if (isSpoken(q)) {
      clips.set(narrationText(q), {
        url: q.audioUrl!,
        seconds: q.audioSeconds,
      });
    }
    if (args.options.withReveal && isRevealSpoken(q)) {
      clips.set(revealText(q), {
        url: q.revealAudioUrl!,
        seconds: q.revealAudioSeconds,
      });
    }
  }

  const distinct = [
    ...new Set(plan(args.questions, args.options).map((j) => j.text)),
  ].filter((t) => !clips.has(t));

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

      // Keyed by position in the distinct list rather than by the text,
      // because the text is a filename here and German lines are full of
      // characters a key cannot carry.
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
    questions: args.questions.map((question) => {
      const ask = clips.get(narrationText(question));
      const reveal = args.options.withReveal
        ? clips.get(revealText(question))
        : undefined;

      return {
        ...question,
        ...(ask
          ? {
              audioUrl: ask.url,
              audioSeconds: ask.seconds,
              audioText: narrationText(question),
            }
          : {}),
        ...(reveal
          ? {
              revealAudioUrl: reveal.url,
              revealAudioSeconds: reveal.seconds,
              revealAudioText: revealText(question),
            }
          : {}),
      };
    }),
    characters,
    clips: clips.size,
    skipped,
  };
}
