/**
 * Deterministischer PRNG (mulberry32).
 *
 * Die Levelgenerierung darf niemals `Math.random()` benutzen: ein Run muss
 * aus seinem Seed reproduzierbar sein (PLAN.md 3.3 und R7).
 */
export class Random {
  private state: number;

  constructor(seed: number) {
    // 0 als Zustand wuerde die Sequenz entarten lassen.
    this.state = (seed >>> 0) || 0x9e3779b9;
  }

  /** Gleichverteilt in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Gleichverteilt in [min, max). */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Ganzzahlig in [min, max] inklusive. */
  int(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1));
  }

  chance(probability: number): boolean {
    return this.next() < probability;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('Random.pick on empty array');
    const item = items[Math.floor(this.next() * items.length)];
    if (item === undefined) throw new Error('Random.pick produced no item');
    return item;
  }

  /** Gewichtete Auswahl. `weightOf` muss nicht-negative Werte liefern. */
  weighted<T>(items: readonly T[], weightOf: (item: T) => number): T {
    let total = 0;
    for (const item of items) total += Math.max(0, weightOf(item));
    if (total <= 0) return this.pick(items);
    let roll = this.next() * total;
    for (const item of items) {
      roll -= Math.max(0, weightOf(item));
      if (roll <= 0) return item;
    }
    return this.pick(items);
  }
}

/** Seed fuer eine neue Run — hier ist echte Zufaelligkeit erwuenscht. */
export function createSeed(): number {
  return (Math.random() * 0xffffffff) >>> 0;
}
