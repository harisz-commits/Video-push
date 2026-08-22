import Phaser from 'phaser';
import { THEME, css } from '@/config/theme';
import { BRANDING } from '@/config/branding';
import type { GameContext } from '@/game/GameContext';

export const SCENE_LOADING = 'Loading';

/**
 * The visible loading screen.
 *
 * `firstFrameReady()` is called from `postupdate` after the first render, not
 * from `create()`: the contract is "a correct visible loading screen has been
 * rendered" (§33), and in create() nothing has been drawn yet.
 */
export class LoadingScene extends Phaser.Scene {
  private context!: GameContext;
  private title!: Phaser.GameObjects.Text;
  private caption!: Phaser.GameObjects.Text;
  private bar!: Phaser.GameObjects.Rectangle;
  private barTrack!: Phaser.GameObjects.Rectangle;
  private framesRendered = 0;
  /** 0..1, drives the bar width independently of the current screen size. */
  private progress = { value: 0 };

  constructor() {
    super(SCENE_LOADING);
  }

  create(): void {
    this.context = this.registry.get('context') as GameContext;

    this.cameras.main.setBackgroundColor(THEME.bg);

    this.title = this.add
      .text(0, 0, BRANDING.fullTitle.toUpperCase(), {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '24px',
        color: css(THEME.text),
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    this.caption = this.add
      .text(0, 0, this.context.i18n.t('loading.title').toUpperCase(), {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '12px',
        color: css(THEME.textMuted),
      })
      .setOrigin(0.5);
    this.caption.setLetterSpacing(3);

    this.barTrack = this.add.rectangle(0, 0, 200, 4, THEME.panelEdge).setOrigin(0, 0.5);
    this.bar = this.add.rectangle(0, 0, 0, 4, THEME.accent).setOrigin(0, 0.5);

    this.layout();
    this.scale.on(Phaser.Scale.Events.RESIZE, this.layout, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, this.layout, this);
    });

    this.tweens.add({
      targets: this.progress,
      value: 1,
      duration: 420,
      ease: 'Sine.easeOut',
      onUpdate: () => this.layout(),
    });
  }

  override update(): void {
    this.framesRendered += 1;

    // Frame 1 is the first one actually presented to the compositor.
    if (this.framesRendered === 1) {
      this.context.platform.firstFrameReady();
      return;
    }

    // Phase 1 has no assets to stream and no save to restore yet; the state
    // is still walked properly so Phase 5 only has to fill in the body.
    if (this.framesRendered === 2) {
      this.context.state.transition('LOADING_SAVE');
      this.caption.setText(this.context.i18n.t('loading.save').toUpperCase());
      return;
    }

    if (this.framesRendered === 30) {
      this.scene.start('Game');
    }
  }

  private layout(): void {
    const { width, height } = this.scale.gameSize;
    const cx = width / 2;
    const cy = height / 2;

    this.title.setPosition(cx, cy - 28);
    this.caption.setPosition(cx, cy + 6);

    const barWidth = Math.min(200, width * 0.6);
    this.barTrack.setPosition(cx - barWidth / 2, cy + 34).setSize(barWidth, 4);
    this.bar
      .setPosition(cx - barWidth / 2, cy + 34)
      .setSize(Math.max(barWidth * this.progress.value, 1), 4);
  }
}
