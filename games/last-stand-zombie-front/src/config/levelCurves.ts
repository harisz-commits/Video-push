/**
 * Wachstums- und Schwierigkeitskurven. Bewusst als Funktionen ueber reinen
 * Parametern, damit Balancing nachvollziehbar bleibt.
 */

export const THREAT = {
  /** Threat Level zu Beginn eines Endless-Runs. */
  base: 0,
  /** Zuwachs pro Sektor. */
  perSector: 1,
  /** Ab hier waechst die Gefahr exponentiell statt linear. */
  exponentialFrom: 8,
  exponentialFactor: 1.12,
} as const;

/** Threat Level nach n abgeschlossenen Sektoren im Endlosmodus. */
export function threatLevelForSector(sectorIndex: number): number {
  const linear = THREAT.base + sectorIndex * THREAT.perSector;
  if (sectorIndex <= THREAT.exponentialFrom) return linear;
  const extra = sectorIndex - THREAT.exponentialFrom;
  return linear * Math.pow(THREAT.exponentialFactor, extra);
}

export const ENEMY_SCALING = {
  /** HP-Faktor pro Threat Level. */
  hpPerThreat: 1.18,
  /** Schadensfaktor pro Threat Level. */
  damagePerThreat: 1.09,
  /** Anzahl-Faktor pro Threat Level (gedeckelt durch die Display Caps). */
  countPerThreat: 1.07,
} as const;

export const UPGRADE_COST = {
  base: 100,
  growth: 1.45,
} as const;

/** Kosten fuer den Sprung von `level` auf `level + 1`. */
export function upgradeCost(level: number): number {
  return Math.round(UPGRADE_COST.base * Math.pow(UPGRADE_COST.growth, level));
}
