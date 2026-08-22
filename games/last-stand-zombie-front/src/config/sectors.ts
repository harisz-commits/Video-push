import type { SectorType } from '../core/Types';

/**
 * Kadenz und Gewichtung der Sektortypen. Ziel ist Abwechslung alle 25-40
 * Sekunden, damit eine Run von 2-5 Minuten nicht monoton wird (PLAN.md R6).
 */

export interface SectorTypeConfig {
  type: SectorType;
  /** Grundgewicht in der Zufallsauswahl. */
  weight: number;
  /** Nicht vor diesem Sektorindex. */
  minSectorIndex: number;
  /** Nie zweimal direkt hintereinander? */
  noRepeat: boolean;
  lengthMeters: number;
}

export const SECTOR_TYPES: readonly SectorTypeConfig[] = [
  { type: 'gates', weight: 100, minSectorIndex: 0, noRepeat: true, lengthMeters: 200 },
  { type: 'combat', weight: 90, minSectorIndex: 1, noRepeat: false, lengthMeters: 230 },
  { type: 'hazard', weight: 55, minSectorIndex: 2, noRepeat: true, lengthMeters: 190 },
  { type: 'elite', weight: 35, minSectorIndex: 3, noRepeat: true, lengthMeters: 170 },
  { type: 'holdout', weight: 25, minSectorIndex: 4, noRepeat: true, lengthMeters: 120 },
  { type: 'boss', weight: 0, minSectorIndex: 4, noRepeat: true, lengthMeters: 140 },
];

/** Feste Abfolge der Kampagne — handgesetzt, dient auch dem Onboarding. */
export const CAMPAIGN_SECTOR_SEQUENCE: readonly SectorType[] = [
  'gates',
  'gates',
  'combat',
  'hazard',
  'boss',
];
