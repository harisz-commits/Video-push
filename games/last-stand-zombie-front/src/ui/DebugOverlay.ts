import { SceneInstrumentation } from '@babylonjs/core/Instrumentation/sceneInstrumentation';
import type { Engine } from '@babylonjs/core/Engines/engine';
import type { Scene } from '@babylonjs/core/scene';
import { UiLayer, el } from './dom';

/** Aktualisierungsintervall des Overlays in Millisekunden. */
const REFRESH_MS = 500;

/**
 * Entwickler-Overlay mit FPS, Draw Calls und Mesh-Zahl.
 *
 * Das groesste technische Risiko des Projekts ist die Crowd-Performance
 * (PLAN.md R1). Ohne sichtbare Zahlen faellt eine Verschlechterung erst spaet
 * auf — deshalb steht der Zaehler ab Phase 1.
 *
 * Draw Calls, nicht aktive Meshes: Instanzen desselben Master-Mesh erscheinen
 * einzeln in der Aktiv-Liste, kosten die GPU aber nur einen Aufruf. Die
 * Aktiv-Zahl wuerde also Alarm schlagen, wo gar keine Kosten entstehen.
 *
 * Sichtbar im Dev-Server oder mit `?debug=1`.
 */
export class DebugOverlay {
  private readonly layer: UiLayer;
  private readonly line: HTMLElement;
  private instrumentation: SceneInstrumentation | null = null;
  private lastRefresh = 0;

  static isEnabled(isDev: boolean): boolean {
    if (isDev) return true;
    return new URLSearchParams(window.location.search).get('debug') === '1';
  }

  constructor(parent: HTMLElement) {
    this.layer = new UiLayer(parent, 'debug');
    this.line = this.layer.add(el('div', 'debug-line', '—'));
  }

  /**
   * Misst die Zeit selbst statt sich auf ein uebergebenes Delta zu verlassen:
   * das Overlay laeuft im Render-Takt, nicht im Simulationstakt.
   */
  update(engine: Engine, scene: Scene | null): void {
    if (!scene) return;
    if (!this.instrumentation || this.instrumentation.scene !== scene) {
      this.instrumentation?.dispose();
      this.instrumentation = new SceneInstrumentation(scene);
      this.instrumentation.captureFrameTime = true;
    }

    const now = performance.now();
    if (now - this.lastRefresh < REFRESH_MS) return;
    this.lastRefresh = now;

    const fps = Math.round(engine.getFps());
    const draws = this.instrumentation.drawCallsCounter.current;
    const frameMs = this.instrumentation.frameTimeCounter.lastSecAverage.toFixed(1);
    this.line.textContent = `${fps} fps · ${frameMs} ms · ${draws} draws · ${scene.meshes.length} meshes`;
  }

  dispose(): void {
    this.instrumentation?.dispose();
    this.instrumentation = null;
    this.layer.dispose();
  }
}
