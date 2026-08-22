import Phaser from 'phaser';
import { THEME, css } from '@/config/theme';
import { BOARD_COLS, BOARD_ROWS, LAYOUT } from '@/config/layout';
import { cellCenter, solveLayout, type Layout } from '@/game/solveLayout';
import type { GameContext } from '@/game/GameContext';

export const SCENE_GAME = 'Game';

/**
 * Phase 1 shell of the play screen.
 *
 * It draws the responsive frame the rest of the game will live in — HUD band,
 * orders band, the 5×6 grid with square cells, and the generator band — and
 * proves that the layout holds up in portrait and landscape. Items, dragging
 * and merging arrive in Phase 2; the placeholders here are labelled as such so
 * nobody mistakes the shell for the feature.
 */
export class GameScene extends Phaser.Scene {
  private context!: GameContext;
  private layout!: Layout;

  private frame!: Phaser.GameObjects.Graphics;
  private hudText!: Phaser.GameObjects.Text;
  private ordersLabel!: Phaser.GameObjects.Text;
  private generatorLabel!: Phaser.GameObjects.Text;
  private phaseNote!: Phaser.GameObjects.Text;
  private readyAnnounced = false;

  constructor() {
    super(SCENE_GAME);
  }

  create(): void {
    this.context = this.registry.get('context') as GameContext;
    this.context.state.transition('PLAYING');

    this.cameras.main.setBackgroundColor(THEME.bg);
    this.frame = this.add.graphics();

    const label = (size: number, color: number) => ({
      fontFamily: 'system-ui, sans-serif',
      fontSize: `${size}px`,
      color: css(color),
    });

    this.hudText = this.add.text(0, 0, '', label(14, THEME.text)).setOrigin(0, 0.5);
    this.ordersLabel = this.add
      .text(0, 0, this.context.i18n.t('orders.title').toUpperCase(), label(11, THEME.textMuted))
      .setOrigin(0.5);
    this.generatorLabel = this.add
      .text(0, 0, this.context.i18n.t('generator.tap').toUpperCase(), label(12, THEME.accent))
      .setOrigin(0.5);
    this.phaseNote = this.add
      // Right-anchored so it can never run off the edge of a narrow HUD.
      .text(0, 0, 'PHASE 1 — LAYOUT SHELL', label(10, THEME.textMuted))
      .setOrigin(1, 0.5);

    this.applyLayout();
    this.scale.on(Phaser.Scale.Events.RESIZE, this.applyLayout, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, this.applyLayout, this);
    });
  }

  override update(): void {
    // gameReady() means the player can actually interact (§34): the board is
    // laid out, input is live, and nothing is covering the screen.
    if (this.readyAnnounced) return;
    this.readyAnnounced = true;
    this.context.platform.gameReady();
  }

  private applyLayout(): void {
    const { width, height } = this.scale.gameSize;
    this.layout = solveLayout(width, height);
    this.draw();
  }

  private draw(): void {
    const l = this.layout;
    const g = this.frame;
    g.clear();

    // Board plate.
    g.fillStyle(THEME.grid, 1);
    g.fillRoundedRect(l.board.x, l.board.y, l.board.width, l.board.height, 14);
    g.lineStyle(1, THEME.gridEdge, 1);
    g.strokeRoundedRect(l.board.x, l.board.y, l.board.width, l.board.height, 14);

    // Cells.
    const inset = Math.max(2, Math.round(l.cellSize * 0.04));
    for (let row = 0; row < BOARD_ROWS; row += 1) {
      for (let col = 0; col < BOARD_COLS; col += 1) {
        const c = cellCenter(l, col, row);
        const size = l.cellSize - inset;
        g.fillStyle(THEME.cell, 1);
        g.fillRoundedRect(c.x - size / 2, c.y - size / 2, size, size, 8);
        g.lineStyle(1, THEME.cellEdge, 0.9);
        g.strokeRoundedRect(c.x - size / 2, c.y - size / 2, size, size, 8);
      }
    }

    // Orders band and generator band, drawn as panels so the proportions of
    // the real UI are visible while balancing the layout.
    this.panel(g, l.orders);
    this.panel(g, l.generator, THEME.accentDim, 0.18);

    const pad = LAYOUT.boardPadding;
    this.hudText
      .setText(
        `${this.context.i18n.t('hud.coins').toUpperCase()} 0   ` +
          `${this.context.i18n.t('hud.rank').toUpperCase()} 1`,
      )
      .setPosition(l.hud.x + pad, l.hud.y + l.hud.height / 2);

    this.ordersLabel.setPosition(l.orders.x + l.orders.width / 2, l.orders.y + l.orders.height / 2);

    // The generator band is wide in portrait and narrow in landscape, so its
    // caption wraps to the panel and scales with it rather than overflowing.
    const generatorWrap = Math.max(l.generator.width - pad * 2, 40);
    this.generatorLabel
      .setFontSize(Math.round(clamp(l.generator.width * 0.07, 10, 15)))
      .setWordWrapWidth(generatorWrap)
      .setAlign('center')
      .setPosition(
        l.generator.x + l.generator.width / 2,
        l.generator.y + l.generator.height / 2,
      );

    this.phaseNote.setPosition(l.hud.x + l.hud.width - pad, l.hud.y + l.hud.height / 2);
  }

  private panel(
    g: Phaser.GameObjects.Graphics,
    rect: { x: number; y: number; width: number; height: number },
    color: number = THEME.panel,
    alpha = 1,
  ): void {
    g.fillStyle(color, alpha);
    g.fillRoundedRect(rect.x, rect.y, rect.width, rect.height, 12);
    g.lineStyle(1, THEME.panelEdge, 1);
    g.strokeRoundedRect(rect.x, rect.y, rect.width, rect.height, 12);
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
