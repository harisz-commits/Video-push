import type { UnitTier } from '../core/Types';

/**
 * Einheiten-Tiers. Reine Daten — kein System darf diese Zahlen hartcodieren.
 *
 * `powerPerUnit` ist immer in Tier-1-Basispunkten (Militia-Power) angegeben.
 * Der Faktor zwischen zwei Tiers betraegt laut Spezifikation 100.
 *
 * `promotionThreshold` ist bewusst NICHT gleich `powerPerUnit`: wuerde man bei
 * exakt 100 Militia befoerdern, stuende danach ein einzelner Rifleman auf dem
 * Feld — das faehlt sich wie ein Rueckschritt an. Stattdessen wird befoerdert,
 * sobald daraus ein sichtbarer Trupp wird (Faktor PROMOTION_SQUAD_SIZE).
 * Die 100:1-Umrechnung bleibt davon unberuehrt.
 */

/** Wie viele Einheiten des neuen Tiers eine Promotion mindestens liefern soll. */
export const PROMOTION_SQUAD_SIZE = 12;

export const UNIT_TIERS: readonly UnitTier[] = [
  {
    id: 'militia',
    name: 'Militia',
    powerPerUnit: 1,
    promotionThreshold: 0,
    damageMultiplier: 1,
    fireRateMultiplier: 1,
    visual: { color: [0.55, 0.62, 0.7], scale: 1, muzzleIntensity: 1 },
  },
  {
    id: 'riflemen',
    name: 'Riflemen',
    powerPerUnit: 1e2,
    promotionThreshold: 1e2 * PROMOTION_SQUAD_SIZE,
    damageMultiplier: 1.15,
    fireRateMultiplier: 1.05,
    visual: { color: [0.3, 0.66, 1], scale: 1.08, muzzleIntensity: 1.4 },
  },
  {
    id: 'veterans',
    name: 'Veterans',
    powerPerUnit: 1e4,
    promotionThreshold: 1e4 * PROMOTION_SQUAD_SIZE,
    damageMultiplier: 1.3,
    fireRateMultiplier: 1.1,
    visual: { color: [0.2, 0.85, 0.62], scale: 1.16, muzzleIntensity: 1.9 },
  },
  {
    id: 'special-forces',
    name: 'Special Forces',
    powerPerUnit: 1e6,
    promotionThreshold: 1e6 * PROMOTION_SQUAD_SIZE,
    damageMultiplier: 1.5,
    fireRateMultiplier: 1.2,
    visual: { color: [0.95, 0.72, 0.22], scale: 1.24, muzzleIntensity: 2.5 },
  },
  {
    id: 'exo-troopers',
    name: 'Heavy Exo Troopers',
    powerPerUnit: 1e8,
    promotionThreshold: 1e8 * PROMOTION_SQUAD_SIZE,
    damageMultiplier: 1.75,
    fireRateMultiplier: 1.3,
    visual: { color: [0.86, 0.32, 0.86], scale: 1.35, muzzleIntensity: 3.2 },
  },
] as const;

export const MAX_TIER_INDEX = UNIT_TIERS.length - 1;

/** Sicherer Zugriff — `noUncheckedIndexedAccess` macht [] sonst optional. */
export function getTier(index: number): UnitTier {
  const clamped = Math.min(Math.max(Math.floor(index), 0), MAX_TIER_INDEX);
  const tier = UNIT_TIERS[clamped];
  if (!tier) throw new Error(`Unit tier ${index} is not defined`);
  return tier;
}
