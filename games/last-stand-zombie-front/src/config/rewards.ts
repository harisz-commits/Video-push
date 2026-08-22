/** Oekonomie: Belohnungen und Score. Alles zentral, keine Magic Numbers. */

export const REWARDS = {
  coinsPerSector: 25,
  coinsPerBoss: 150,
  coinsPerKill: 0.4,
  techPartsPerBoss: 1,
  /** Wahrscheinlichkeit, dass ein Elitegegner ein Tech Part fallen laesst. */
  techPartEliteChance: 0.25,
  /** Faktor der Rewarded-Ad-Verdopplung am Rundenende. */
  rewardedMultiplier: 2,
} as const;

export const SCORE = {
  perSector: 500,
  perKill: 5,
  perBoss: 2500,
  perTierIndex: 5000,
  /** Verbleibende Combat Power geht gedaempft in den Score ein. */
  combatPowerExponent: 0.6,
  combatPowerFactor: 12,
  /** Multiplikator pro Threat Level im Endlosmodus. */
  endlessThreatFactor: 0.08,
} as const;
