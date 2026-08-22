import type { Scene as BabylonScene } from '@babylonjs/core/scene';
import type { Engine } from '@babylonjs/core/Engines/engine';
import type { EventBus } from '../core/EventBus';
import type { GameState } from '../core/GameState';
import type { PlatformService } from '../platform/PlatformService';
import type { SaveManager } from '../save/SaveManager';
import type { SceneId } from '../core/Types';
import type { InputController } from '../app/InputController';

/** Alles, was eine Szene von der Anwendung braucht. */
export interface SceneContext {
  readonly engine: Engine;
  readonly canvas: HTMLCanvasElement;
  readonly uiRoot: HTMLElement;
  readonly bus: EventBus;
  readonly state: GameState;
  readonly platform: PlatformService;
  readonly save: SaveManager;
  readonly input: InputController;
  /** Szenenwechsel anfordern. Wird erst am Ende des Frames ausgefuehrt. */
  requestScene(id: SceneId): void;
}

/**
 * Basisklasse aller Szenen.
 *
 * Lebenszyklus: `enter()` → n× (`update()` fixed step, dann `beforeRender()`)
 * → `exit()`. Jede Szene raeumt in `exit()` restlos auf — sowohl ihre
 * Babylon-Knoten als auch DOM und Event-Abos.
 */
export abstract class GameScene {
  abstract readonly id: SceneId;

  /** Von der Szene erzeugte Babylon-Szene; `null` bei reinen DOM-Szenen. */
  babylonScene: BabylonScene | null = null;

  protected readonly disposers: Array<() => void> = [];

  constructor(protected readonly ctx: SceneContext) {}

  abstract enter(): void | Promise<void>;

  /** Simulationsschritt mit fester Schrittweite (Sekunden). */
  update(_dtSeconds: number): void {}

  /**
   * Direkt vor dem Rendern. `alpha` ist der Anteil [0,1) des angefangenen
   * Simulationsschritts und erlaubt visuelle Interpolation.
   */
  beforeRender(_alpha: number): void {}

  /** Reagiert auf Groessenaenderungen des Fensters. */
  resize(): void {}

  exit(): void {
    for (const dispose of this.disposers.splice(0)) {
      try {
        dispose();
      } catch (error) {
        this.ctx.platform.logError(`scene "${this.id}" cleanup failed`, error);
      }
    }
    this.babylonScene?.dispose();
    this.babylonScene = null;
  }

  /** Aufraeumschritt registrieren, der in `exit()` ausgefuehrt wird. */
  protected onExit(dispose: () => void): void {
    this.disposers.push(dispose);
  }
}
