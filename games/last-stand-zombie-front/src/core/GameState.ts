import type { GameMode, RunResult, SceneId } from './Types';
import type { EventBus } from './EventBus';
import type { SaveData } from '../save/SaveSchema';

/**
 * Der geteilte Zustand der Anwendung — bewusst schlank. Alles, was nur
 * innerhalb einer Run gilt, lebt im RunDirector (ab Phase 5), nicht hier.
 */
export class GameState {
  scene: SceneId | null = null;
  /** Gewaehlter Modus fuer die naechste/laufende Run. */
  mode: GameMode = 'campaign';
  /** Zuletzt abgeschlossene Run — Grundlage des Results-Screens. */
  lastResult: RunResult | null = null;
  /** Persistenter Spielstand. Wird beim Boot geladen. */
  save: SaveData | null = null;
  /** Von der Plattform gemeldeter Pausenzustand. */
  paused = false;
  /** Von der Plattform gemeldeter Audiozustand. */
  audioEnabled = true;

  constructor(readonly bus: EventBus) {}

  setScene(next: SceneId): void {
    const from = this.scene;
    if (from === next) return;
    this.scene = next;
    this.bus.emit('scene:changed', { from, to: next });
  }

  requireSave(): SaveData {
    if (!this.save) throw new Error('Save data accessed before boot completed');
    return this.save;
  }
}
