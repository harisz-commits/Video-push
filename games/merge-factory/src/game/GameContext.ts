import type Phaser from 'phaser';
import { GameStateMachine } from './GameStateMachine';
import { LocalizationManager } from '@/localization/LocalizationManager';
import type { PlatformService, Unsubscribe } from '@/platform/PlatformService';

/**
 * The dependency container every scene reads from.
 *
 * One object passed down beats a pile of module-level singletons: tests can
 * build a context with a fake platform, and there is exactly one place that
 * knows how pause, resume and host mute reach the rest of the game.
 */
export class GameContext {
  readonly platform: PlatformService;
  readonly state = new GameStateMachine();
  readonly i18n = new LocalizationManager();

  private phaser: Phaser.Game | null = null;
  private subscriptions: Unsubscribe[] = [];

  constructor(platform: PlatformService) {
    this.platform = platform;
    this.i18n.setLocaleFromTag(platform.getLanguage());
  }

  /** Called once the Phaser game exists, so pause can reach the loop. */
  attachPhaser(game: Phaser.Game): void {
    this.phaser = game;
    // Host pause/resume is the only pause source (§23). Page Visibility is
    // explicitly NOT used as a substitute.
    this.subscriptions.push(
      this.platform.subscribePause(() => this.pause()),
      this.platform.subscribeResume(() => this.resume()),
    );
  }

  detach(): void {
    for (const off of this.subscriptions) off();
    this.subscriptions = [];
    this.phaser = null;
  }

  /**
   * The one pause path: loop, tweens, timers, input and audio stop together,
   * and a save is triggered. Phase 5 hooks the save and audio in here; the
   * ordering is fixed now so nothing else grows its own pause handling.
   */
  pause(): void {
    if (this.state.state === 'PAUSED') return;
    this.state.pause();
    const game = this.phaser;
    if (!game) return;
    game.loop.sleep();
    for (const scene of game.scene.getScenes(true)) {
      scene.scene.pause();
      scene.tweens.pauseAll();
      scene.time.paused = true;
      scene.input.enabled = false;
    }
    game.sound.pauseAll();
  }

  resume(): void {
    if (this.state.state !== 'PAUSED') return;
    this.state.resume();
    const game = this.phaser;
    if (!game) return;
    game.loop.wake();
    for (const scene of game.scene.getScenes(false)) {
      if (!scene.scene.isPaused()) continue;
      scene.scene.resume();
      scene.tweens.resumeAll();
      scene.time.paused = false;
      scene.input.enabled = true;
    }
    game.sound.resumeAll();
  }
}
