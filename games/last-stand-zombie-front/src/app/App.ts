import { Engine } from '@babylonjs/core/Engines/engine';
import type { SceneId } from '../core/Types';
import type { PlatformService } from '../platform/PlatformService';
import type { GameScene, SceneContext } from '../scenes/GameScene';
import { EventBus } from '../core/EventBus';
import { GameState } from '../core/GameState';
import { SaveManager } from '../save/SaveManager';
import { SceneManager, type SceneFactory } from './SceneManager';
import { InputController } from './InputController';
import { RENDER, SIMULATION } from '../config/gameBalance';
import { BootScene } from '../scenes/BootScene';
import { LoadingScene } from '../scenes/LoadingScene';
import { MenuScene } from '../scenes/MenuScene';
import { RunScene } from '../scenes/RunScene';
import { ResultsScene } from '../scenes/ResultsScene';

const FIXED_STEP_SECONDS = 1 / SIMULATION.tickHz;

/**
 * Anwendungsrahmen: Engine, Render-Schleife, Szenenwechsel, Plattform-Lifecycle.
 *
 * Die Simulation laeuft mit fester Schrittweite (PLAN.md Regel 5), damit
 * Balancing nicht von der Framerate abhaengt. Gerenderte Frames und
 * Simulationsschritte sind entkoppelt.
 */
export class App {
  private readonly engine: Engine;
  private readonly bus = new EventBus();
  private readonly state: GameState;
  private readonly saveManager: SaveManager;
  private readonly input: InputController;
  private readonly scenes: SceneManager;

  private accumulator = 0;
  private lastTimestamp = 0;
  private running = false;
  private paused = false;
  private firstFrameReported = false;
  private readonly unsubscribes: Array<() => void> = [];

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly uiRoot: HTMLElement,
    private readonly platform: PlatformService,
  ) {
    this.engine = new Engine(canvas, true, {
      preserveDrawingBuffer: false,
      stencil: false,
      antialias: true,
      powerPreference: 'high-performance',
      // Babylons eigene Audio-Engine bleibt aus: Ton laeuft ueber den
      // AudioManager, der den Plattform-Audiostatus respektiert.
      audioEngine: false,
      // Sonst friert der Kontext bei kurzem Tab-Wechsel ein.
      doNotHandleContextLost: false,
    });
    this.applyPixelRatio();

    this.state = new GameState(this.bus);
    this.saveManager = new SaveManager(platform, this.bus);
    this.input = new InputController(canvas);

    const factories: Record<SceneId, SceneFactory> = {
      boot: (ctx) => new BootScene(ctx),
      loading: (ctx) => new LoadingScene(ctx),
      menu: (ctx) => new MenuScene(ctx),
      run: (ctx) => new RunScene(ctx),
      results: (ctx) => new ResultsScene(ctx),
    };
    this.scenes = new SceneManager(this.createContext(), factories);
  }

  async start(): Promise<void> {
    this.wirePlatformLifecycle();
    window.addEventListener('resize', this.onResize);
    this.scenes.request('boot');
    this.running = true;
    this.lastTimestamp = performance.now();
    this.engine.runRenderLoop(this.onFrame);
  }

  dispose(): void {
    this.running = false;
    this.engine.stopRenderLoop(this.onFrame);
    window.removeEventListener('resize', this.onResize);
    for (const unsubscribe of this.unsubscribes.splice(0)) unsubscribe();
    this.input.detach();
    this.scenes.dispose();
    this.bus.clear();
    this.engine.dispose();
  }

  private createContext(): SceneContext {
    return {
      engine: this.engine,
      canvas: this.canvas,
      uiRoot: this.uiRoot,
      bus: this.bus,
      state: this.state,
      platform: this.platform,
      save: this.saveManager,
      input: this.input,
      requestScene: (id) => this.scenes.request(id),
    };
  }

  private readonly onFrame = (): void => {
    if (!this.running) return;

    const now = performance.now();
    const elapsed = (now - this.lastTimestamp) / 1000;
    this.lastTimestamp = now;

    const scene: GameScene | null = this.scenes.current;

    if (!this.paused && scene) {
      // Sehr grosse Spruenge (Tab war im Hintergrund) werden verworfen,
      // statt sie nachzusimulieren.
      this.accumulator = Math.min(
        this.accumulator + elapsed,
        FIXED_STEP_SECONDS * SIMULATION.maxTicksPerFrame,
      );

      let ticks = 0;
      while (this.accumulator >= FIXED_STEP_SECONDS && ticks < SIMULATION.maxTicksPerFrame) {
        this.input.update(FIXED_STEP_SECONDS);
        scene.update(FIXED_STEP_SECONDS);
        this.accumulator -= FIXED_STEP_SECONDS;
        ticks += 1;
      }
      scene.beforeRender(this.accumulator / FIXED_STEP_SECONDS);
    }

    scene?.babylonScene?.render();

    if (!this.firstFrameReported) {
      this.firstFrameReported = true;
      this.platform.firstFrameReady();
    }

    void this.scenes.processPending();
  };

  private wirePlatformLifecycle(): void {
    this.unsubscribes.push(
      this.platform.subscribePause(() => {
        if (this.paused) return;
        this.paused = true;
        this.state.paused = true;
        this.accumulator = 0;
        this.bus.emit('platform:pause', {});
        // Fortschritt sichern, solange die Seite noch lebt.
        void this.saveManager.flush();
      }),
      this.platform.subscribeResume(() => {
        if (!this.paused) return;
        this.paused = false;
        this.state.paused = false;
        this.lastTimestamp = performance.now();
        this.bus.emit('platform:resume', {});
      }),
      this.platform.subscribeAudioChange((enabled) => {
        this.state.audioEnabled = enabled;
        this.bus.emit('platform:audio', { enabled });
      }),
    );
    this.state.audioEnabled = this.platform.isAudioEnabled();
  }

  private readonly onResize = (): void => {
    this.applyPixelRatio();
    this.engine.resize();
    this.scenes.current?.resize();
  };

  /**
   * Begrenzt die effektive Aufloesung. Auf einem 3x-Display waere die native
   * Pixelzahl ein Vielfaches dessen, was fuer diesen Stil noetig ist.
   */
  private applyPixelRatio(): void {
    const ratio = Math.min(window.devicePixelRatio || 1, RENDER.maxPixelRatio);
    this.engine.setHardwareScalingLevel(1 / ratio);
  }
}
