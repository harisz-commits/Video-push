import Phaser from 'phaser';
import type { GameContext } from '@/game/GameContext';

export const SCENE_BOOT = 'Boot';

/**
 * First scene: takes the HTML preloader down and hands over to LoadingScene.
 * Nothing heavy happens here — the sooner a real frame is on screen, the
 * sooner `firstFrameReady()` can fire (§33).
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super(SCENE_BOOT);
  }

  create(): void {
    const context = this.registry.get('context') as GameContext;
    context.state.transition('LOADING');

    document.getElementById('preloader')?.remove();

    this.scene.start('Loading');
  }
}
