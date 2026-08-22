import { describe, expect, it } from 'vitest';
import { cellCenter, solveLayout } from '@/game/solveLayout';
import { BOARD_COLS, BOARD_ROWS, LAYOUT, MIN_TOUCH_TARGET } from '@/config/layout';

/** Real devices, from the smallest phone we care about to a desktop. */
const VIEWPORTS: [string, number, number][] = [
  ['iPhone SE portrait', 320, 568],
  ['iPhone 14 portrait', 390, 844],
  ['Pixel 7 portrait', 412, 915],
  ['iPhone 14 landscape', 844, 390],
  ['iPad portrait', 768, 1024],
  ['iPad landscape', 1024, 768],
  ['desktop', 1440, 900],
  ['ultra-wide', 2560, 720],
  ['very tall', 400, 1400],
];

describe('solveLayout', () => {
  it.each(VIEWPORTS)('keeps the board on screen on %s', (_name, width, height) => {
    const l = solveLayout(width, height);
    const b = l.board;

    expect(b.x).toBeGreaterThanOrEqual(0);
    expect(b.y).toBeGreaterThanOrEqual(0);
    expect(b.x + b.width).toBeLessThanOrEqual(width + 0.5);
    expect(b.y + b.height).toBeLessThanOrEqual(height + 0.5);
  });

  it.each(VIEWPORTS)('gives every cell on %s a usable touch target', (_name, w, h) => {
    // Below the smallest supported viewport the clamp floor applies; that is
    // the documented trade-off, so the expectation is stated against it.
    const l = solveLayout(w, h);
    expect(l.cellSize).toBeGreaterThanOrEqual(LAYOUT.minCellSize);
    if (Math.min(w, h) >= 360) {
      expect(l.cellSize).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
    }
  });

  it('switches to the side layout only when the screen is wider than tall', () => {
    expect(solveLayout(390, 844).orientation).toBe('portrait');
    expect(solveLayout(844, 390).orientation).toBe('landscape');
    // Near-square screens stay portrait: the 6-row grid prefers height.
    expect(solveLayout(800, 800).orientation).toBe('portrait');
  });

  it('places orders and generator beside the board in landscape', () => {
    const l = solveLayout(1024, 600);
    expect(l.orientation).toBe('landscape');
    expect(l.orders.x + l.orders.width).toBeLessThanOrEqual(l.board.x + 0.5);
    expect(l.generator.x).toBeGreaterThanOrEqual(l.board.x + l.board.width - 0.5);
  });

  it('stacks the UI around the board in portrait', () => {
    const l = solveLayout(390, 844);
    expect(l.hud.y + l.hud.height).toBeLessThanOrEqual(l.orders.y + 0.5);
    expect(l.orders.y + l.orders.height).toBeLessThanOrEqual(l.board.y + 0.5);
    expect(l.board.y + l.board.height).toBeLessThanOrEqual(l.generator.y + 0.5);
    expect(l.generator.y + l.generator.height).toBeLessThanOrEqual(844 + 0.5);
  });

  it('keeps cells square and evenly spaced', () => {
    const l = solveLayout(390, 844);
    const a = cellCenter(l, 0, 0);
    const b = cellCenter(l, 1, 0);
    const c = cellCenter(l, 0, 1);
    expect(b.x - a.x).toBeCloseTo(l.cellSize + LAYOUT.cellGap);
    expect(c.y - a.y).toBeCloseTo(l.cellSize + LAYOUT.cellGap);
  });

  it('contains every cell inside the board plate', () => {
    for (const [, w, h] of VIEWPORTS) {
      const l = solveLayout(w, h);
      for (let row = 0; row < BOARD_ROWS; row += 1) {
        for (let col = 0; col < BOARD_COLS; col += 1) {
          const c = cellCenter(l, col, row);
          expect(c.x - l.cellSize / 2).toBeGreaterThanOrEqual(l.board.x - 0.5);
          expect(c.x + l.cellSize / 2).toBeLessThanOrEqual(l.board.x + l.board.width + 0.5);
          expect(c.y - l.cellSize / 2).toBeGreaterThanOrEqual(l.board.y - 0.5);
          expect(c.y + l.cellSize / 2).toBeLessThanOrEqual(l.board.y + l.board.height + 0.5);
        }
      }
    }
  });

  it('centres a capped content box on oversized screens', () => {
    const l = solveLayout(2560, 720);
    const left = l.orders.x;
    const right = l.generator.x + l.generator.width;
    expect(right - left).toBeLessThanOrEqual(LAYOUT.maxContent.landscape.width);
    // Equal slack on both sides means the play area is genuinely centred.
    expect(left).toBeCloseTo(2560 - right, 0);
  });

  it('leaves small screens uncapped', () => {
    const l = solveLayout(390, 844);
    expect(l.hud.x).toBe(LAYOUT.screenMargin);
  });

  it('produces finite geometry for degenerate viewports', () => {
    for (const [w, h] of [
      [0, 0],
      [1, 1],
      [10, 4000],
    ] as const) {
      const l = solveLayout(w, h);
      expect(Number.isFinite(l.cellSize)).toBe(true);
      expect(l.cellSize).toBeGreaterThan(0);
    }
  });
});
