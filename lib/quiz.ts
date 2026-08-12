import { z } from "zod";

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
    const thinkFrames = s(question.thinkSeconds);
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

  const outroFrames = project.outro ? s(BEATS.outro) : 0;

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
