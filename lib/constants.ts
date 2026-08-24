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

/**
 * The video format: a spoken story over generated pictures.
 *
 * A third composition rather than a variant of the first. Both are timed by
 * the voice, but the infographics film searches for anchor phrases in a script
 * somebody wrote, while this one wrote its own cut and knows every offset by
 * construction — so they share a clock and nothing else.
 */
export const STORY_COMP_NAME = "StoryVideo";

/**
 * The vertical cut of a film.
 *
 * Its own composition rather than a flag on the other one: the canvas is a
 * different shape, the pictures are cropped instead of fitted, the text is
 * burnt in, and there is a spoken hook in front. Sharing one component would
 * mean a conditional at every one of those points.
 */
export const STORY_SHORT_COMP_NAME = "StoryShort";

/**
 * Das Finanz-Format: gesprochener Text über Grafiken aus Zahlen.
 *
 * Eine eigene Komposition statt eines Schalters in StoryVideo, obwohl beide
 * dieselbe Uhr benutzen. Der Grund ist, was auf dem Schirm steht: dort ein
 * Bild, das die ganze Fläche füllt und langsam wandert, hier eine Grafik mit
 * Überschrift, Achsen, Beschriftung und Quellenzeile. Eine Komponente für
 * beides wäre an jeder dieser Stellen eine Verzweigung.
 */
export const FINANCE_COMP_NAME = "FinanceVideo";

/** Which renderer a project belongs to. The studio's switch sets this. */
export type Format = "infographics" | "quiz" | "video" | "finanz";

export const COMP_FOR: Record<Format, string> = {
  infographics: COMP_NAME,
  quiz: QUIZ_COMP_NAME,
  video: STORY_COMP_NAME,
  finanz: FINANCE_COMP_NAME,
};
