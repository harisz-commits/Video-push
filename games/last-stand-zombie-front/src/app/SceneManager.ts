import type { GameScene, SceneContext } from '../scenes/GameScene';
import type { SceneId } from '../core/Types';

export type SceneFactory = (ctx: SceneContext) => GameScene;

/**
 * Verwaltet genau eine aktive Szene.
 *
 * Wechsel werden nicht sofort ausgefuehrt, sondern am Frame-Ende — eine Szene
 * soll sich nicht mitten in ihrem eigenen `update()` abbauen koennen.
 */
export class SceneManager {
  private active: GameScene | null = null;
  private pending: SceneId | null = null;
  private switching = false;

  constructor(
    private readonly ctx: SceneContext,
    private readonly factories: Readonly<Record<SceneId, SceneFactory>>,
  ) {}

  get current(): GameScene | null {
    return this.active;
  }

  request(id: SceneId): void {
    this.pending = id;
  }

  /** Fuehrt einen vorgemerkten Wechsel aus. Vom Render-Loop aufgerufen. */
  async processPending(): Promise<void> {
    if (this.pending === null || this.switching) return;
    const next = this.pending;
    this.pending = null;
    this.switching = true;
    try {
      await this.activate(next);
    } catch (error) {
      this.ctx.platform.logError(`failed to enter scene "${next}"`, error);
    } finally {
      this.switching = false;
    }
  }

  private async activate(id: SceneId): Promise<void> {
    if (this.active) {
      this.active.exit();
      this.active = null;
    }
    const factory = this.factories[id];
    const scene = factory(this.ctx);
    this.active = scene;
    this.ctx.state.setScene(id);
    await scene.enter();
  }

  dispose(): void {
    this.active?.exit();
    this.active = null;
    this.pending = null;
  }
}
