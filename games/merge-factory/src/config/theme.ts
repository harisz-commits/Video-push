/**
 * Clean industrial palette (briefing §20): metal, workshop, neon readouts.
 * Bold and high-contrast, deliberately not a children's palette.
 */
export const THEME = {
  bg: 0x0d1117,
  bgDeep: 0x090c11,
  panel: 0x161b22,
  panelEdge: 0x2b333d,
  grid: 0x1b222c,
  gridEdge: 0x30393f,
  cell: 0x131a22,
  cellEdge: 0x273040,

  accent: 0xff8a1f, // hot metal orange — primary action colour
  accentDim: 0xb35d10,
  neon: 0x2ee6a8, // readouts, positive feedback
  neonDim: 0x1a9c72,
  danger: 0xff4d4d,
  coin: 0xffc73a,

  text: 0xe6edf3,
  textMuted: 0x8b949e,
} as const;

/** CSS-string form for the few places Phaser wants a string colour. */
export function css(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}
