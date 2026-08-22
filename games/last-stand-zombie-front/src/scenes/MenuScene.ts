import { Scene } from '@babylonjs/core/scene';
import { TargetCamera } from '@babylonjs/core/Cameras/targetCamera';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color4 } from '@babylonjs/core/Maths/math.color';
import { GameScene } from './GameScene';
import type { GameMode, SceneId } from '../core/Types';
import { createMainMenu } from '../ui/Menus';

/**
 * Hauptmenue: Moduswahl und Waehrungsanzeige.
 *
 * Der 3D-Hintergrund ist hier absichtlich leer — eine Menuekulisse kostet
 * Ladezeit und Draw Calls, ohne bis Phase 9 etwas beizutragen.
 */
export class MenuScene extends GameScene {
  readonly id: SceneId = 'menu';

  enter(): void {
    const scene = new Scene(this.ctx.engine);
    scene.clearColor = new Color4(0.04, 0.05, 0.07, 1);
    scene.skipPointerMovePicking = true;
    const camera = new TargetCamera('menu-camera', new Vector3(0, 0, -10), scene);
    camera.setTarget(Vector3.Zero());
    scene.activeCamera = camera;
    this.babylonScene = scene;

    const save = this.ctx.state.requireSave();
    const unlocked = new Set<GameMode>(['campaign', 'survival']);
    if (save.unlocks.includes('endless')) unlocked.add('endless');

    const menu = createMainMenu(this.ctx.uiRoot, {
      coins: save.meta.coins,
      techParts: save.meta.techParts,
      bestScore: save.stats.bestScore,
      unlocked,
      onPlay: (mode) => {
        this.ctx.state.mode = mode;
        this.ctx.requestScene('run');
      },
    });
    this.onExit(() => menu.dispose());
  }
}
