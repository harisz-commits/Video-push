/**
 * The channel's visual identity. These values are fixed — every scene reads
 * from here so a palette change is one edit, not nine.
 */
export const C = {
  bg: "#0E1A2B", // deep navy, ground of every scene
  bgAlt: "#152438", // panel / card on the ground
  wheat: "#E3B23C", // primary accent, numbers, highlights
  signal: "#C4452F", // crisis, break, collapse
  mint: "#4FB99F", // solution, the positive turn from scene 10 on
  ink: "#F2EFE8", // text on navy
  muted: "#7E90A6", // secondary text, axes, grid
} as const;

export const FONT = {
  display: "ArchivoExpanded",
  body: "InterTight",
  mono: "JetBrainsMono",
} as const;

/** 1920x1080 with a 96px safe area on every edge. */
export const SAFE = 96;
export const CANVAS = { width: 1920, height: 1080 } as const;

/** Shared type ramps, so scenes stay in the same family without copy-paste. */
export const TYPE = {
  hook: {
    fontFamily: FONT.display,
    fontWeight: 700,
    fontSize: 120,
    letterSpacing: "-0.01em",
    textTransform: "uppercase" as const,
    lineHeight: 1.02,
    color: C.ink,
  },
  headline: {
    fontFamily: FONT.display,
    fontWeight: 700,
    fontSize: 76,
    letterSpacing: "-0.01em",
    textTransform: "uppercase" as const,
    lineHeight: 1.05,
    color: C.ink,
  },
  sub: {
    fontFamily: FONT.body,
    fontWeight: 500,
    fontSize: 34,
    color: C.muted,
    lineHeight: 1.35,
  },
  label: {
    fontFamily: FONT.body,
    fontWeight: 500,
    fontSize: 28,
    color: C.muted,
  },
  number: {
    fontFamily: FONT.mono,
    fontWeight: 700,
    fontSize: 160,
    // Tabular figures: without this, counters jitter horizontally as they count up.
    fontVariantNumeric: "tabular-nums" as const,
    color: C.wheat,
    letterSpacing: "-0.02em",
  },
  axis: {
    fontFamily: FONT.mono,
    fontWeight: 700,
    fontSize: 22,
    fontVariantNumeric: "tabular-nums" as const,
    color: C.muted,
  },
  caption: {
    fontFamily: FONT.body,
    fontWeight: 500,
    fontSize: 34,
    color: C.ink,
  },
} as const;

/** Timing constants shared by all scene animations. */
export const T = {
  /** Elements scale up from 0.92 with opacity 0 -> 1 over this many frames. */
  enter: 12,
  /** Delay between elements of a group. */
  stagger: 4,
  /** Counters count up over this many frames. */
  count: 30,
  /** Cross-fade used only for the navy -> mint turn. */
  phaseFade: 8,
} as const;
