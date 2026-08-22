#!/usr/bin/env node
/**
 * Packt `dist/` zu einem einreichbaren ZIP. `index.html` liegt im Root des
 * Archivs — ein umschliessender Ordner wuerde die Einreichung ungueltig machen.
 *
 * Bewusst ohne npm-Abhaengigkeit: das systemeigene `zip` reicht, und jede
 * zusaetzliche Build-Abhaengigkeit ist eine mehr, die brechen kann.
 */
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(ROOT, 'dist');
const OUT_DIR = join(ROOT, 'dist-zip');
const OUT_FILE = join(OUT_DIR, 'last-stand-zombie-front.zip');

if (!existsSync(DIST)) {
  console.error('✗ dist/ not found — run "npm run build" first.');
  process.exit(1);
}

mkdirSync(OUT_DIR, { recursive: true });
rmSync(OUT_FILE, { force: true });

try {
  execFileSync('zip', ['-r', '-q', '-9', OUT_FILE, '.'], { cwd: DIST, stdio: 'inherit' });
} catch (error) {
  console.error('✗ zip failed. Install the "zip" utility or archive dist/ manually.');
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

console.log(`✓ ${OUT_FILE}`);
