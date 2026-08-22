import { BOARD_COLS, BOARD_ROWS, LAYOUT } from '@/config/layout';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Layout {
  orientation: 'portrait' | 'landscape';
  width: number;
  height: number;
  cellSize: number;
  /** The grid itself, cells plus internal gaps. */
  board: Rect;
  /** Top status bar: coins, rank. */
  hud: Rect;
  /** Up to three active orders (§8). */
  orders: Rect;
  /** The scrap generator (§7). */
  generator: Rect;
}

/**
 * Pure layout solver — no Phaser, no DOM, so it is directly testable.
 *
 * The rule that makes both orientations work: cells stay square, and the cell
 * size is whatever fits in *both* the width left for the board and the height
 * left for it. Portrait stacks HUD / orders / board / generator; landscape
 * puts orders on the left of the board and the generator on the right, which
 * is the only arrangement where a 6-row grid survives a short viewport.
 */
export function solveLayout(width: number, height: number): Layout {
  const orientation: Layout['orientation'] =
    width / Math.max(height, 1) >= LAYOUT.landscapeAspect ? 'landscape' : 'portrait';

  // Everything is solved inside a centred content box, which on large screens
  // is smaller than the viewport. The offsets are added back at the end, so
  // the band maths below never has to know about it.
  const cap = LAYOUT.maxContent[orientation];
  const contentW = Math.min(width, cap.width);
  const contentH = Math.min(height, cap.height);
  const offsetX = (width - contentW) / 2;
  const offsetY = (height - contentH) / 2;

  const m = LAYOUT.screenMargin;
  const innerW = Math.max(contentW - m * 2, 1);
  const innerH = Math.max(contentH - m * 2, 1);

  const layout =
    orientation === 'portrait'
      ? solvePortrait(width, height, innerW, innerH, m)
      : solveLandscape(width, height, innerW, innerH, m);

  return offsetLayout(layout, offsetX, offsetY);
}

function offsetLayout(layout: Layout, dx: number, dy: number): Layout {
  if (dx === 0 && dy === 0) return layout;
  const move = (r: Rect): Rect => ({ ...r, x: r.x + dx, y: r.y + dy });
  return {
    ...layout,
    board: move(layout.board),
    hud: move(layout.hud),
    orders: move(layout.orders),
    generator: move(layout.generator),
  };
}

function solvePortrait(
  width: number,
  height: number,
  innerW: number,
  innerH: number,
  m: number,
): Layout {
  const { portrait, cellGap, boardPadding } = LAYOUT;

  const hudH = innerH * portrait.hudBand;
  const ordersH = innerH * portrait.ordersBand;
  const generatorH = innerH * portrait.generatorBand;
  const boardH = innerH - hudH - ordersH - generatorH;

  const cellSize = fitCell(innerW, boardH, cellGap, boardPadding);
  const board = centeredBoard(cellSize, cellGap, boardPadding, {
    x: m,
    y: m + hudH + ordersH,
    width: innerW,
    height: boardH,
  });

  return {
    orientation: 'portrait',
    width,
    height,
    cellSize,
    board,
    hud: { x: m, y: m, width: innerW, height: hudH },
    orders: { x: m, y: m + hudH, width: innerW, height: ordersH },
    generator: {
      x: m,
      y: m + hudH + ordersH + boardH,
      width: innerW,
      height: generatorH,
    },
  };
}

function solveLandscape(
  width: number,
  height: number,
  innerW: number,
  innerH: number,
  m: number,
): Layout {
  const { landscape, cellGap, boardPadding } = LAYOUT;

  const hudH = innerH * landscape.hudBand;
  const bodyY = m + hudH;
  const bodyH = innerH - hudH;

  const sideW = innerW * landscape.sideBand * 0.5;
  const boardW = innerW - sideW * 2;

  const cellSize = fitCell(boardW, bodyH, cellGap, boardPadding);
  const board = centeredBoard(cellSize, cellGap, boardPadding, {
    x: m + sideW,
    y: bodyY,
    width: boardW,
    height: bodyH,
  });

  return {
    orientation: 'landscape',
    width,
    height,
    cellSize,
    board,
    hud: { x: m, y: m, width: innerW, height: hudH },
    orders: { x: m, y: bodyY, width: sideW, height: bodyH },
    generator: { x: m + sideW + boardW, y: bodyY, width: sideW, height: bodyH },
  };
}

/** Largest square cell that fits the available box in both axes. */
function fitCell(
  availableW: number,
  availableH: number,
  gap: number,
  padding: number,
): number {
  const usableW = availableW - padding * 2 - gap * (BOARD_COLS - 1);
  const usableH = availableH - padding * 2 - gap * (BOARD_ROWS - 1);
  const raw = Math.min(usableW / BOARD_COLS, usableH / BOARD_ROWS);
  return clamp(Math.floor(raw), LAYOUT.minCellSize, LAYOUT.maxCellSize);
}

function centeredBoard(cellSize: number, gap: number, padding: number, box: Rect): Rect {
  const width = cellSize * BOARD_COLS + gap * (BOARD_COLS - 1) + padding * 2;
  const height = cellSize * BOARD_ROWS + gap * (BOARD_ROWS - 1) + padding * 2;
  return {
    x: box.x + (box.width - width) / 2,
    y: box.y + (box.height - height) / 2,
    width,
    height,
  };
}

/** Centre position of a grid cell in screen space. */
export function cellCenter(
  layout: Layout,
  col: number,
  row: number,
): { x: number; y: number } {
  const { cellGap, boardPadding } = LAYOUT;
  const step = layout.cellSize + cellGap;
  return {
    x: layout.board.x + boardPadding + col * step + layout.cellSize / 2,
    y: layout.board.y + boardPadding + row * step + layout.cellSize / 2,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
