import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(import.meta.dirname, '..', 'src');

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (entry.endsWith('.ts')) out.push(full);
  }
  return out;
}

/** Nur echte Imports, keine Erwaehnungen in Kommentaren. */
function importedModules(content: string): string[] {
  const modules: string[] = [];
  const pattern = /^\s*import\s[^;]*?from\s+['"]([^'"]+)['"]|^\s*import\s+['"]([^'"]+)['"]/gm;
  for (const match of content.matchAll(pattern)) {
    const spec = match[1] ?? match[2];
    if (spec) modules.push(spec);
  }
  return modules;
}

const FILES = sourceFiles(SRC).map((path) => ({
  path,
  rel: relative(SRC, path).split(sep).join('/'),
  imports: importedModules(readFileSync(path, 'utf8')),
}));

describe('architecture rules', () => {
  /**
   * PLAN.md Regel 1: Nur die Plattformschicht kennt YouTube. Bricht diese
   * Regel, laesst sich die Playables-Anbindung nicht mehr isoliert testen
   * oder austauschen.
   */
  it('keeps the YouTube SDK inside platform/', () => {
    const offenders = FILES.filter(
      (file) =>
        !file.rel.startsWith('platform/') &&
        file.imports.some((spec) => spec.includes('ytgame')),
    ).map((file) => file.rel);

    expect(offenders).toEqual([]);
  });

  /**
   * PLAN.md Regel 2: Spiellogik bleibt frei von Babylon, sonst laesst sie
   * sich nicht ohne Browser testen.
   */
  it('keeps Babylon out of the simulation layers', () => {
    const logicPrefixes = [
      'core/',
      'config/',
      'run/',
      'save/',
      'util/',
      'army/',
      'enemies/',
      'combat/',
      'progression/',
    ];

    const offenders = FILES.filter(
      (file) =>
        logicPrefixes.some((prefix) => file.rel.startsWith(prefix)) &&
        file.imports.some((spec) => spec.startsWith('@babylonjs')),
    ).map((file) => file.rel);

    expect(offenders).toEqual([]);
  });

  it('actually scanned the source tree', () => {
    expect(FILES.length).toBeGreaterThan(20);
    expect(FILES.some((file) => file.rel.startsWith('platform/'))).toBe(true);
  });
});
