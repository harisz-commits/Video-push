/**
 * Projektweite Basistypen. Diese Datei importiert bewusst nichts —
 * sie ist die Wurzel des Abhaengigkeitsgraphen.
 */

export type GameMode = 'campaign' | 'survival' | 'endless';

export type SceneId = 'boot' | 'loading' | 'menu' | 'run' | 'results';

/** Zustand der Armee. Siehe PLAN.md 3.1. */
export interface ArmyState {
  /** Mathematische Wahrheit, immer in Tier-1-Basiseinheiten. */
  combatPower: number;
  /** Index in UNIT_TIERS. */
  tierIndex: number;
  /** Abgeleitet, nur fuer die Darstellung. */
  displayCount: number;
  /** Anteil [0,1) einer angefangenen Einheit des aktuellen Tiers. */
  overflowProgress: number;
}

export interface UnitTier {
  id: string;
  name: string;
  /** Wie viele Tier-1-Basispunkte eine sichtbare Einheit dieses Tiers wert ist. */
  powerPerUnit: number;
  /** Ab dieser Combat Power darf an einem Checkpoint hierher befoerdert werden. */
  promotionThreshold: number;
  damageMultiplier: number;
  fireRateMultiplier: number;
  /** Rendering-Hinweise, damit hoehere Tiers sichtbar maechtiger wirken. */
  visual: {
    color: [number, number, number];
    scale: number;
    /** Anzahl Muendungsfeuer-Partikel pro Schuss, rein kosmetisch. */
    muzzleIntensity: number;
  };
}

export type SectorType =
  | 'gates'
  | 'combat'
  | 'hazard'
  | 'elite'
  | 'holdout'
  | 'boss';

export interface RunStats {
  sectorsCleared: number;
  kills: number;
  bossesKilled: number;
  peakTierIndex: number;
  peakCombatPower: number;
  coinsEarned: number;
  durationSeconds: number;
}

export interface RunResult {
  mode: GameMode;
  victory: boolean;
  score: number;
  stats: RunStats;
}

/** Normalisierter Eingabezustand, unabhaengig von Maus/Touch/Tastatur. */
export interface InputState {
  /** Ziel-Lateralposition [-1, 1] relativ zur Fahrbahnbreite. */
  lateral: number;
  /** Liegt gerade ein Finger/Mausknopf an? */
  active: boolean;
}

/**
 * Alle Ereignisse des Spiels an einer Stelle. Der EventBus ist darueber
 * typisiert, damit publish/subscribe nicht auseinanderlaufen koennen.
 */
export interface GameEventMap {
  'scene:changed': { from: SceneId | null; to: SceneId };
  'loading:progress': { ratio: number };
  'run:started': { mode: GameMode; seed: number };
  'run:ended': RunResult;
  'run:distance': { meters: number };
  'army:changed': ArmyState;
  'army:promoted': { fromTierIndex: number; toTierIndex: number };
  'platform:pause': Record<string, never>;
  'platform:resume': Record<string, never>;
  'platform:audio': { enabled: boolean };
  'save:written': Record<string, never>;
}

export type GameEventName = keyof GameEventMap;
