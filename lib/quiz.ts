import { z } from "zod";
import { ThumbnailConfig } from "./thumbnail";

/**
 * The quiz format.
 *
 * Deliberately not built on top of the infographics project. The two formats
 * disagree about the one thing that matters most — where time comes from.
 *
 * An infographics video is timed by the voice: a scene lasts exactly as long
 * as the sentence that belongs to it, which is why its scenes drift to eleven
 * seconds when the writer puts an anchor in the wrong place. A quiz is timed by
 * a clock: five seconds to think is five seconds whatever anyone says over it.
 * That is the whole reason this format can hit the pace the other one keeps
 * missing, and it only works if the clock is the source of truth rather than
 * something layered on afterwards.
 *
 * So: durations here are data, in seconds, and the voiceover is fitted to them
 * rather than the other way round.
 */

/**
 * How hard a question is.
 *
 * Never written on screen. The words are English, they mean nothing to a
 * German-speaking viewer mid-question, and labelling a question "EASY" in
 * front of somebody who then gets it wrong is the one thing this format must
 * not do. The difficulty is carried entirely by colour and by the tempo of the
 * music — both of which a viewer reads without being told they are reading it.
 */
export const QuizLevel = z.enum(["easy", "medium", "hard", "impossible"]);
export type QuizLevel = z.infer<typeof QuizLevel>;

export const QuizQuestion = z.object({
  id: z.string(),
  level: QuizLevel,
  /** The question itself — short enough to read in the time it is on screen. */
  prompt: z.string().min(3).max(140),
  /**
   * An ISO 3166-1 alpha-2 code, when the question is "which country is this".
   * The flag is drawn from a local file; nothing is fetched at render time.
   */
  flag: z
    .string()
    .regex(/^[a-z]{2}$/, "Zwei Kleinbuchstaben, z. B. de")
    .optional(),
  /** Exactly three, because the layout is built for three. */
  answers: z.array(z.string().min(1).max(48)).length(3),
  correctIndex: z.number().int().min(0).max(2),
  /** How long the timer runs. The only knob that changes the pace. */
  thinkSeconds: z.number().min(2).max(12).default(5),
  /** What the host says while the clock runs. Silence is what kills retention. */
  hype: z.string().max(60).optional(),
  /**
   * A recording that IS the question.
   *
   * For a language quiz there is nothing to look at — the question is a voice
   * saying a sentence, and the viewer's job is to name the language. The clip
   * has to finish before the timer does, so its length is stored with it.
   */
  audioUrl: z.string().url().optional(),
  audioSeconds: z.number().positive().max(30).optional(),
});
export type QuizQuestion = z.infer<typeof QuizQuestion>;

export const QuizProject = z.object({
  kind: z.literal("quiz"),
  id: z.string(),
  topic: z.string(),
  title: z.string(),
  /** Spoken over the opening card. Five seconds, then straight into question 1. */
  intro: z.string().min(3).max(200),
  outro: z.string().max(200).optional(),
  /**
   * What the host says over the end card.
   *
   * Its own field rather than the on-screen text read aloud: the card is a
   * sentence you glance at, the voice is a question asked directly, and the
   * two want different words. The written line thanks; the spoken one asks
   * something the viewer can only answer in the comments.
   */
  outroSpeech: z.string().max(300).optional(),
  outroAudioUrl: z.string().url().optional(),
  /**
   * How long that recording is.
   *
   * Stored because the end card has to be at least as long as the sentence
   * spoken over it, and nothing at render time can measure an mp3 behind a URL.
   */
  outroAudioSeconds: z.number().positive().max(30).optional(),
  /**
   * Whether the three options are shown.
   *
   * A presentation choice, not a property of the questions — the wrong answers
   * stay in the data either way, so this can be flipped on a finished quiz
   * without regenerating anything.
   *
   * With options it is a multiple-choice game and a viewer can play along by
   * elimination. Without them it is a recall test: harder, faster to read, and
   * the reveal lands as an answer rather than as a tick next to one of three
   * boxes they had already narrowed down.
   */
  showAnswers: z.boolean().default(true),
  /**
   * Which kind of quiz this is.
   *
   * Only the presentation differs: "general" shows a flag or plain text,
   * "language" shows a speaker while a clip plays and never shows a flag —
   * a flag beside a spoken sentence would answer the question before it was
   * asked.
   */
  mode: z.enum(["general", "language"]).default("general"),
  /** How the thumbnail for this video is set up. See lib/thumbnail.ts. */
  thumbnail: ThumbnailConfig.optional(),
  questions: z.array(QuizQuestion).min(1).max(60),
  audioUrl: z.string().url().optional(),
  fps: z.literal(30).default(30),
  width: z.literal(1920).default(1920),
  height: z.literal(1080).default(1080),
});
export type QuizProject = z.infer<typeof QuizProject>;

/**
 * Fixed beats, in seconds.
 *
 * Every one of these is under the five-second rule by construction, and the
 * longest single stretch without a visible change is the think phase — which
 * is not a standstill either, because the timer bar is draining the whole time.
 */
export const BEATS = {
  /** The opening card. Short on purpose: the reference format is in the first question by second five. */
  intro: 4,
  /** Question sliding in before the clock starts. */
  enter: 0.6,
  /** Correct answer green, wrong ones struck out. */
  reveal: 2.4,
  /** The wipe between questions. Overlaps nothing; it is its own beat. */
  exit: 0.35,
  /**
   * The end card. Three seconds was enough to say goodbye and not enough to
   * ask for anything, and the ask is what these seconds are for.
   */
  outro: 6,
} as const;

export type QuizSlot = {
  index: number;
  question: QuizQuestion;
  from: number;
  durationInFrames: number;
  /** Offsets within the slot, in frames, relative to `from`. */
  enterFrames: number;
  thinkFrames: number;
  revealFrames: number;
  exitFrames: number;
};

export type QuizTiming = {
  introFrames: number;
  slots: QuizSlot[];
  outroFrom: number;
  outroFrames: number;
  totalFrames: number;
};

export function resolveQuizTiming(project: QuizProject): QuizTiming {
  const fps = project.fps;
  const s = (seconds: number) => Math.round(seconds * fps);

  const introFrames = s(BEATS.intro);
  let cursor = introFrames;

  const slots: QuizSlot[] = project.questions.map((question, index) => {
    const enterFrames = s(BEATS.enter);
    // A question that is a recording cannot be shorter than the recording.
    // The clock still rules the format — it just has to wait for the sentence
    // to finish before it can be allowed to run out.
    const thinkFrames = s(
      question.audioSeconds
        ? Math.max(question.thinkSeconds, question.audioSeconds + 1.6)
        : question.thinkSeconds,
    );
    const revealFrames = s(BEATS.reveal);
    const exitFrames = s(BEATS.exit);
    const durationInFrames =
      enterFrames + thinkFrames + revealFrames + exitFrames;

    const slot: QuizSlot = {
      index,
      question,
      from: cursor,
      durationInFrames,
      enterFrames,
      thinkFrames,
      revealFrames,
      exitFrames,
    };
    cursor += durationInFrames;
    return slot;
  });

  // Long enough for whatever is said over it, with a beat of air at the end so
  // the last word is not cut off by the fade.
  const outroSeconds = project.outroAudioSeconds
    ? Math.max(BEATS.outro, project.outroAudioSeconds + 1.4)
    : BEATS.outro;
  const outroFrames = project.outro ? s(outroSeconds) : 0;

  return {
    introFrames,
    slots,
    outroFrom: cursor,
    outroFrames,
    totalFrames: Math.max(1, cursor + outroFrames),
  };
}

/** Seconds of finished video, for the studio to show before anything renders. */
export function quizDurationSeconds(project: QuizProject): number {
  return resolveQuizTiming(project).totalFrames / project.fps;
}
