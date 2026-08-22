import { Scene } from '@babylonjs/core/scene';
import { TargetCamera } from '@babylonjs/core/Cameras/targetCamera';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color4 } from '@babylonjs/core/Maths/math.color';
import { GameScene } from './GameScene';
import type { SceneId } from '../core/Types';
import { createResultsScreen } from '../ui/ResultsScreen';

/**
 * Rundenabschluss.
 *
 * Phase 1 zeigt die Zusammenfassung und schreibt Statistik/Score in den
 * Spielstand. Belohnungen, Rewarded-Ad-Verdopplung und Interstitials
 * folgen in Phase 6 bzw. 8 — die Stellen sind im Code markiert.
 */
export class ResultsScene extends GameScene {
  readonly id: SceneId = 'results';

  enter(): void {
    const scene = new Scene(this.ctx.engine);
    scene.clearColor = new Color4(0.04, 0.05, 0.07, 1);
    scene.skipPointerMovePicking = true;
    const camera = new TargetCamera('results-camera', new Vector3(0, 0, -10), scene);
    camera.setTarget(Vector3.Zero());
    scene.activeCamera = camera;
    this.babylonScene = scene;

    const result = this.ctx.state.lastResult;
    if (!result) {
      this.ctx.platform.logWarning('results scene without a result — back to menu');
      this.ctx.requestScene('menu');
      return;
    }

    this.ctx.save.update((save) => {
      save.stats.runs += 1;
      save.stats.kills += result.stats.kills;
      save.stats.bestScore = Math.max(save.stats.bestScore, result.score);
      save.meta.coins += result.stats.coinsEarned;
      save.progress.highestTierIndex = Math.max(
        save.progress.highestTierIndex,
        result.stats.peakTierIndex,
      );
    });
    void this.ctx.save.flush();
    void this.ctx.platform.sendScore(result.score);

    // TODO(Phase 8): Interstitial an dieser natuerlichen Pause anbieten.
    const screen = createResultsScreen(this.ctx.uiRoot, {
      result,
      onContinue: () => this.ctx.requestScene('menu'),
      onRetry: () => this.ctx.requestScene('run'),
    });
    this.onExit(() => screen.dispose());
  }
}
