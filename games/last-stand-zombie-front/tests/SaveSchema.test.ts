import { describe, expect, it } from 'vitest';
import {
  CURRENT_SAVE_VERSION,
  createDefaultSave,
  normalizeSave,
} from '../src/save/SaveSchema';
import { migrate } from '../src/save/migrations';

describe('save schema', () => {
  it('round-trips a default save through JSON unchanged', () => {
    const original = createDefaultSave();
    const restored = normalizeSave(JSON.parse(JSON.stringify(original)));
    expect(restored).toEqual(original);
  });

  it('falls back to defaults for junk input', () => {
    expect(normalizeSave(null)).toEqual(createDefaultSave());
    expect(normalizeSave('nope')).toEqual(createDefaultSave());
    expect(normalizeSave([1, 2, 3])).toEqual(createDefaultSave());
  });

  it('keeps valid fields and repairs broken neighbours', () => {
    const result = normalizeSave({
      version: 1,
      meta: { coins: 250, techParts: 'broken', xp: Number.NaN },
      upgrades: { firepower: 3, bogus: 'x', negative: -2 },
      stats: { bestScore: 9000 },
      tutorialDone: true,
    });

    expect(result.meta.coins).toBe(250);
    expect(result.meta.techParts).toBe(0);
    expect(result.meta.xp).toBe(0);
    expect(result.upgrades).toEqual({ firepower: 3 });
    expect(result.stats.bestScore).toBe(9000);
    expect(result.stats.kills).toBe(0);
    expect(result.tutorialDone).toBe(true);
  });

  it('stamps the current version onto unversioned data', () => {
    const migrated = migrate({ meta: { coins: 5 } }, 0, CURRENT_SAVE_VERSION);
    expect(migrated['version']).toBe(CURRENT_SAVE_VERSION);
    expect(normalizeSave(migrated).meta.coins).toBe(5);
  });

  it('throws when a migration step is missing', () => {
    expect(() => migrate({}, CURRENT_SAVE_VERSION, CURRENT_SAVE_VERSION + 1)).toThrow(
      /Missing save migration/,
    );
  });
});
