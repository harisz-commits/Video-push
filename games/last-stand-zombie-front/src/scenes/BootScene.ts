import { GameScene } from './GameScene';
import type { SceneId } from '../core/Types';

/**
 * Erste Szene: laedt den Spielstand und gibt sofort weiter.
 * Nichts Sichtbares — der Boot-Splash aus `index.html` steht noch.
 */
export class BootScene extends GameScene {
  readonly id: SceneId = 'boot';

  async enter(): Promise<void> {
    try {
      this.ctx.state.save = await this.ctx.save.load();
    } catch (error) {
      this.ctx.platform.logError('save load failed — using defaults', error);
      this.ctx.state.save = this.ctx.save.current;
    }
    this.ctx.state.audioEnabled = this.ctx.platform.isAudioEnabled();
    this.ctx.requestScene('loading');
  }
}
