import type { QuizLevel } from "../../lib/quiz";

/**
 * One palette per difficulty.
 *
 * The colour is the progress bar of the whole video: a viewer who has been
 * watching for two minutes can tell they have moved from green to orange
 * without anyone saying so. That is the entire psychological trick of the
 * format, and it only works if the shift is large enough to notice at a
 * glance — so these are four clearly different worlds, not four tints.
 */
export type LevelSkin = {
  /** The two ends of the background gradient, behind the rays. */
  deep: string;
  lift: string;
  /** The rays themselves — barely lighter than `lift`, or they scream. */
  ray: string;
  /** Cards, boxes, and the timer bar. */
  accent: string;
  ink: string;
};

export const LEVELS: Record<QuizLevel, LevelSkin> = {
  easy: {
    deep: "#04302B",
    lift: "#0A5C4E",
    ray: "#0D6B5B",
    accent: "#2BE0A8",
    ink: "#F2FFFB",
  },
  medium: {
    deep: "#05243F",
    lift: "#0A4373",
    ray: "#0C4E85",
    accent: "#37B6FF",
    ink: "#F0F8FF",
  },
  hard: {
    deep: "#3A1704",
    lift: "#7A3208",
    ray: "#8E3B09",
    accent: "#FF9426",
    ink: "#FFF6EC",
  },
  impossible: {
    deep: "#2E0518",
    lift: "#6B0C33",
    ray: "#7D0E3B",
    accent: "#FF3D71",
    ink: "#FFF0F5",
  },
};

/**
 * How long each level's music loop is, in seconds.
 *
 * Derived rather than measured: the bed is sixteen beats, so the length is
 * 16 × 60 / bpm. Kept next to the palettes because the two climb together —
 * the tempo rises with the colour, which is the same progression told twice.
 */
const BPM: Record<QuizLevel, number> = {
  easy: 104,
  medium: 116,
  hard: 128,
  impossible: 140,
};

export const BED_SECONDS: Record<QuizLevel, number> = {
  easy: (16 * 60) / BPM.easy,
  medium: (16 * 60) / BPM.medium,
  hard: (16 * 60) / BPM.hard,
  impossible: (16 * 60) / BPM.impossible,
};

/** Green for right, red for wrong — the two colours nobody has to learn. */
export const RIGHT = "#1FD87A";
export const WRONG = "#FF4757";
export const MUTED = "#6E7A88";
