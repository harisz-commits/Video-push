/**
 * Gegner-Archetypen als reine Daten. Wird ab Phase 4 vom EnemyManager gelesen.
 * `power` ist in Tier-1-Basispunkten angegeben, also derselben Waehrung wie die
 * Combat Power der Armee — dadurch bleibt der Schadensvergleich trivial.
 */

export type EnemyArchetypeId =
  | 'walker'
  | 'runner'
  | 'tank'
  | 'spitter'
  | 'exploder'
  | 'shielded'
  | 'brute';

export interface EnemyArchetype {
  id: EnemyArchetypeId;
  name: string;
  /** HP in Basispunkten. */
  hp: number;
  /** Schaden an der Combat Power pro Treffer. */
  damage: number;
  /** Meter pro Sekunde. */
  speed: number;
  /** Reichweite in Metern; 0 = Nahkampf. */
  range: number;
  /** Relative Spawn-Haeufigkeit; wird pro Sektortyp gewichtet. */
  weight: number;
  /** Ab diesem Threat Level darf der Typ auftauchen. */
  minThreatLevel: number;
  visual: { color: [number, number, number]; scale: number };
}

export const ENEMY_ARCHETYPES: Readonly<Record<EnemyArchetypeId, EnemyArchetype>> = {
  walker: {
    id: 'walker', name: 'Walker', hp: 4, damage: 1, speed: 2.2, range: 0,
    weight: 100, minThreatLevel: 0,
    visual: { color: [0.42, 0.55, 0.32], scale: 1 },
  },
  runner: {
    id: 'runner', name: 'Runner', hp: 3, damage: 2, speed: 6.4, range: 0,
    weight: 45, minThreatLevel: 1,
    visual: { color: [0.72, 0.62, 0.24], scale: 0.92 },
  },
  tank: {
    id: 'tank', name: 'Tank Zombie', hp: 45, damage: 5, speed: 1.5, range: 0,
    weight: 18, minThreatLevel: 2,
    visual: { color: [0.35, 0.44, 0.3], scale: 1.45 },
  },
  spitter: {
    id: 'spitter', name: 'Spitter', hp: 8, damage: 3, speed: 1.8, range: 14,
    weight: 22, minThreatLevel: 3,
    visual: { color: [0.55, 0.78, 0.28], scale: 1.05 },
  },
  exploder: {
    id: 'exploder', name: 'Exploder', hp: 6, damage: 12, speed: 3.6, range: 2,
    weight: 16, minThreatLevel: 3,
    visual: { color: [0.82, 0.36, 0.24], scale: 1.1 },
  },
  shielded: {
    id: 'shielded', name: 'Shielded Mutant', hp: 30, damage: 4, speed: 2.4, range: 0,
    weight: 14, minThreatLevel: 4,
    visual: { color: [0.5, 0.5, 0.58], scale: 1.2 },
  },
  brute: {
    id: 'brute', name: 'Brute', hp: 120, damage: 14, speed: 2.8, range: 0,
    weight: 6, minThreatLevel: 5,
    visual: { color: [0.6, 0.26, 0.26], scale: 1.9 },
  },
};
