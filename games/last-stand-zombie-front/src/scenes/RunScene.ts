import { Scene } from '@babylonjs/core/scene';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { GameScene } from './GameScene';
import type { SceneId } from '../core/Types';
import { RunCamera } from './playfield/RunCamera';
import { TrackScenery } from './playfield/TrackScenery';
import { SquadMarker } from './playfield/SquadMarker';
import { RunKinematics } from '../run/RunKinematics';
import { HUD } from '../ui/HUD';
import { DebugOverlay } from '../ui/DebugOverlay';
import { button } from '../ui/dom';
import { UiLayer } from '../ui/dom';
import { ARMY, RENDER, RUN } from '../config/gameBalance';
import { getTier } from '../config/unitTiers';
import { createSeed } from '../util/Random';
import { clamp } from '../util/math';
import { IS_DEV } from '../core/Config';

/**
 * Die Run-Szene.
 *
 * PHASE 1 — Umfang bewusst begrenzt: automatische Vorwaertsbewegung,
 * Lateralsteuerung, Verfolgerkamera, scrollende Kulisse, HUD-Geruest.
 * Es gibt noch keine Armee, keine Gates, keine Gegner und keinen
 * RunDirector; diese haengen sich ab Phase 2 an dieselben Stellen:
 *
 *   update()        → RunDirector.tick(), ArmyManager, CombatSystem
 *   beforeRender()  → Crowd-Renderer statt SquadMarker
 *   Sektorlogik     → SectorGenerator statt fester Distanzschwelle
 */
export class RunScene extends GameScene {
  readonly id: SceneId = 'run';

  private camera: RunCamera | null = null;
  private scenery: TrackScenery | null = null;
  private squad: SquadMarker | null = null;
  private hud: HUD | null = null;
  private debug: DebugOverlay | null = null;
  private readonly kinematics = new RunKinematics();
  private elapsed = 0;
  private sectorIndex = 0;

  enter(): void {
    const scene = new Scene(this.ctx.engine);
    scene.clearColor = new Color4(0.05, 0.07, 0.09, 1);
    // Weniger Arbeit pro Frame: es gibt in dieser Szene nichts anzuklicken.
    scene.skipPointerMovePicking = true;
    scene.autoClearDepthAndStencil = true;
    scene.fogMode = Scene.FOGMODE_LINEAR;
    scene.fogStart = RENDER.fogStart;
    scene.fogEnd = RENDER.fogEnd;
    scene.fogColor = new Color3(0.05, 0.07, 0.09);
    this.babylonScene = scene;

    const ambient = new HemisphericLight('ambient', new Vector3(0, 1, 0), scene);
    ambient.intensity = 0.72;
    ambient.diffuse = new Color3(0.75, 0.82, 1);
    ambient.groundColor = new Color3(0.16, 0.14, 0.12);

    const sun = new DirectionalLight('sun', new Vector3(-0.4, -1, 0.55), scene);
    sun.intensity = 1.1;
    sun.diffuse = new Color3(1, 0.94, 0.82);

    this.camera = new RunCamera(scene);
    this.scenery = new TrackScenery(scene);
    this.squad = new SquadMarker(scene, this.ctx.state.requireSave().progress.highestTierIndex);

    this.kinematics.reset();
    this.elapsed = 0;
    this.sectorIndex = 0;
    this.camera.snapTo(0, 0);

    this.ctx.input.reset();
    this.ctx.input.attach();
    this.onExit(() => this.ctx.input.detach());

    this.hud = new HUD(this.ctx.uiRoot);
    this.onExit(() => this.hud?.dispose());

    if (DebugOverlay.isEnabled(IS_DEV)) {
      this.debug = new DebugOverlay(this.ctx.uiRoot);
      this.onExit(() => this.debug?.dispose());
    }

    // Vorlaeufiger Abbruchknopf, bis es echte Endbedingungen gibt.
    const controls = new UiLayer(this.ctx.uiRoot, 'run-controls');
    controls.add(button('End run', () => this.finishRun(), 'ghost'));
    this.onExit(() => controls.dispose());

    this.ctx.bus.emit('run:started', {
      mode: this.ctx.state.mode,
      seed: createSeed(),
    });
  }

  override update(dt: number): void {
    this.elapsed += dt;
    this.kinematics.update(this.ctx.input.lateral, dt);
    this.scenery?.update(this.kinematics.distance);
    // Die Kamera laeuft im Simulationstakt mit: ihre Glaettung haengt damit
    // nicht an der Framerate, und gerenderte Frames finden sie fertig vor.
    this.camera?.follow(this.kinematics.x, this.kinematics.distance, dt);

    const sector = Math.floor(this.kinematics.distance / RUN.sectorLengthMeters);
    if (sector !== this.sectorIndex) {
      this.sectorIndex = sector;
      // Ab Phase 5 uebernimmt hier der RunDirector: Sektorwechsel,
      // Checkpoint-Auswahl, Promotion.
    }

    this.ctx.bus.emit('run:distance', { meters: this.kinematics.distance });
  }

  override beforeRender(_alpha: number): void {
    this.squad?.update(
      this.kinematics.x,
      this.kinematics.distance,
      this.kinematics.lateralVelocity,
      this.elapsed,
    );

    const progress = clamp(
      (this.kinematics.distance % RUN.sectorLengthMeters) / RUN.sectorLengthMeters,
      0,
      1,
    );
    this.hud?.render({
      tierName: getTier(this.ctx.state.requireSave().progress.highestTierIndex).name,
      displayCount: 6,
      combatPower: ARMY.startCombatPower,
      sectorProgress: progress,
      sectorIndex: this.sectorIndex,
      elapsedSeconds: this.elapsed,
    });

    this.debug?.update(this.ctx.engine, this.babylonScene);
  }

  override resize(): void {
    this.camera?.applyFov();
  }

  override exit(): void {
    this.scenery?.dispose();
    this.scenery = null;
    this.squad?.dispose();
    this.squad = null;
    this.camera = null;
    this.hud = null;
    this.debug = null;
    super.exit();
  }

  /** Platzhalter-Rundenende. Ab Phase 5 kommt das Ergebnis vom RunDirector. */
  private finishRun(): void {
    const result = {
      mode: this.ctx.state.mode,
      victory: false,
      score: Math.round(this.kinematics.distance * 10),
      stats: {
        sectorsCleared: this.sectorIndex,
        kills: 0,
        bossesKilled: 0,
        peakTierIndex: 0,
        peakCombatPower: ARMY.startCombatPower,
        coinsEarned: 0,
        durationSeconds: this.elapsed,
      },
    };
    this.ctx.state.lastResult = result;
    this.ctx.bus.emit('run:ended', result);
    this.ctx.requestScene('results');
  }
}
