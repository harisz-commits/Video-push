/**
 * Board geometry and layout budgets (briefing §6 and §27).
 *
 * The board is 5×6 in portrait. In landscape the grid keeps its shape and the
 * surrounding UI moves to the sides instead of stacking above and below —
 * that is the only way a 5-wide × 6-tall grid stays playable on a short,
 * wide screen.
 */
export const BOARD_COLS = 5;
export const BOARD_ROWS = 6;
export const BOARD_CELLS = BOARD_COLS * BOARD_ROWS;

/** Touch targets must not fall below ~44 CSS px (§27). */
export const MIN_TOUCH_TARGET = 44;

export const LAYOUT = {
  /** Below this aspect ratio the portrait stack is used. */
  landscapeAspect: 1.05,
  cellGap: 6,
  boardPadding: 10,
  screenMargin: 12,
  /** Fractions of the short axis reserved for the UI around the board. */
  portrait: { ordersBand: 0.2, generatorBand: 0.16, hudBand: 0.075 },
  landscape: { sideBand: 0.3, hudBand: 0.11 },
  minCellSize: 34,
  maxCellSize: 120,
  /**
   * On large screens the UI is centred inside a capped content box instead of
   * being stretched edge to edge. A 5-wide grid spread across a 2560 px
   * monitor puts the generator an arm's length from the board; capping keeps
   * the same comfortable reach on every screen.
   */
  maxContent: {
    portrait: { width: 560, height: 1100 },
    landscape: { width: 1240, height: 900 },
  },
} as const;
