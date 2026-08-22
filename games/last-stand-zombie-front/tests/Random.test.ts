import { describe, expect, it } from 'vitest';
import { Random } from '../src/util/Random';

describe('Random', () => {
  it('produces the same sequence for the same seed', () => {
    const a = new Random(1234);
    const b = new Random(1234);
    const seqA = Array.from({ length: 20 }, () => a.next());
    const seqB = Array.from({ length: 20 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it('produces different sequences for different seeds', () => {
    const a = Array.from({ length: 10 }, (_, i) => new Random(i).next());
    expect(new Set(a).size).toBe(a.length);
  });

  it('stays inside [0, 1)', () => {
    const rng = new Random(99);
    for (let i = 0; i < 5000; i += 1) {
      const value = rng.next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('does not degenerate on seed 0', () => {
    const rng = new Random(0);
    const values = Array.from({ length: 5 }, () => rng.next());
    expect(new Set(values).size).toBe(values.length);
  });

  it('keeps int() inside the inclusive bounds', () => {
    const rng = new Random(7);
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i += 1) seen.add(rng.int(3, 6));
    expect([...seen].sort()).toEqual([3, 4, 5, 6]);
  });

  it('respects weights', () => {
    const rng = new Random(42);
    const items = [
      { id: 'common', weight: 90 },
      { id: 'rare', weight: 10 },
    ];
    let common = 0;
    for (let i = 0; i < 4000; i += 1) {
      if (rng.weighted(items, (item) => item.weight).id === 'common') common += 1;
    }
    expect(common / 4000).toBeGreaterThan(0.85);
    expect(common / 4000).toBeLessThan(0.95);
  });

  it('falls back to a uniform pick when all weights are zero', () => {
    const rng = new Random(3);
    const items = [{ w: 0 }, { w: 0 }];
    expect(items).toContain(rng.weighted(items, (item) => item.w));
  });
});
