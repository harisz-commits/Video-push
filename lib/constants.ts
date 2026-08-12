/**
 * Plain constants shared by the server routes and the Remotion entry point.
 *
 * Kept free of React imports on purpose: /api/render only needs the composition
 * id, and importing it from Root.tsx would drag the entire component tree into
 * a server route.
 */
export const COMP_NAME = "InfographicsVideo";

/**
 * The quiz format's composition.
 *
 * A separate composition rather than a branch inside the first one: the two
 * formats disagree about where time comes from — one is timed by the voice,
 * the other by a clock — so they cannot share a `calculateMetadata`, which is
 * the function that decides how long the video is.
 */
export const QUIZ_COMP_NAME = "QuizVideo";

/** Which renderer a project belongs to. The studio's switch sets this. */
export type Format = "infographics" | "quiz";

export const COMP_FOR: Record<Format, string> = {
  infographics: COMP_NAME,
  quiz: QUIZ_COMP_NAME,
};
