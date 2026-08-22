import { GameScene } from './GameScene';
import type { SceneId } from '../core/Types';
import { clamp } from '../util/math';

/** So lange laeuft der Balken mindestens — ein Aufblitzen wirkt kaputt. */
const MIN_DURATION_SECONDS = 0.5;

/**
 * Ladeszene.
 *
 * Phase 1 hat noch keine Assets zu laden; der Balken laeuft deshalb ueber
 * eine Mindestdauer. Ab Phase 9 (Audio/VFX) haengt hier der echte
 * Ladefortschritt dran — die Struktur bleibt dieselbe.
 *
 * Hier faellt auch `gameReady()`: ab jetzt ist das Spiel bedienbar.
 */
export class LoadingScene extends GameScene {
  readonly id: SceneId = 'loading';

  private elapsed = 0;
  private done = false;
  private fill: HTMLElement | null = null;

  enter(): void {
    this.fill = document.getElementById('boot-bar-fill');
  }

  override update(dt: number): void {
    if (this.done) return;
    this.elapsed += dt;
    const ratio = clamp(this.elapsed / MIN_DURATION_SECONDS, 0, 1);
    if (this.fill) this.fill.style.width = `${Math.round(ratio * 100)}%`;
    this.ctx.bus.emit('loading:progress', { ratio });

    if (ratio >= 1) {
      this.done = true;
      document.getElementById('boot-splash')?.classList.add('hidden');
      this.ctx.platform.gameReady();
      this.ctx.requestScene('menu');
    }
  }
}
