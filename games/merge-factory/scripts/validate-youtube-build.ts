/**
 * YouTube Playables build validator (briefing §38).
 *
 * Answers one question: would this `dist` be accepted, and would it behave?
 * Every check is a hard PASS/FAIL or a WARN; the script exits non-zero on any
 * failure so `npm run youtube:build` cannot produce a broken ZIP.
 *
 *   npm run youtube:validate
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { scanDirectory, scanFile } from './scan-forbidden-urls';

const DIST = 'dist';
const SDK_URL = 'https://www.youtube.com/game_api/v1';

/** Internal budgets, deliberately stricter than the platform limits (§31). */
const BUDGETS = {
  totalBytes: 20 * 1024 * 1024,
  initialDownloadBytes: 10 * 1024 * 1024,
  singleFileBytes: 8 * 1024 * 1024,
  fileCount: 500,
  /** Worst-case serialized savegame; the hard limit is far above this (§24). */
  saveBytes: 16 * 1024,
};

type Status = 'PASS' | 'FAIL' | 'WARN';

interface Check {
  name: string;
  status: Status;
  detail: string;
}

const checks: Check[] = [];

function record(name: string, ok: boolean, detail: string, warnOnly = false): void {
  checks.push({ name, status: ok ? 'PASS' : warnOnly ? 'WARN' : 'FAIL', detail });
}

function main(): void {
  if (!existsSync(DIST)) {
    console.error(`✖ ${DIST}/ not found. Run \`npm run build\` first.`);
    process.exit(1);
  }

  const files = listFiles(DIST);
  const indexPath = join(DIST, 'index.html');

  checkIndexHtml(indexPath);
  checkAssetPaths(indexPath, files);
  checkForbiddenUrls(indexPath);
  checkFileNames(files);
  checkSizes(files);
  checkSaveSchemaSize();

  report();
}

// --- individual checks -------------------------------------------------

function checkIndexHtml(indexPath: string): void {
  const present = existsSync(indexPath);
  record('index.html present at dist root', present, present ? indexPath : 'missing');
  if (!present) return;

  const html = readFileSync(indexPath, 'utf8');

  const sdkIndex = html.indexOf(SDK_URL);
  record('YouTube SDK script present', sdkIndex >= 0, sdkIndex >= 0 ? SDK_URL : 'not found');
  if (sdkIndex < 0) return;

  // The SDK must be parsed before any game code runs, otherwise
  // detectPlatform() sees no `ytgame` and falls back to local mode inside
  // Playables — which would silently break saves, ads and pause.
  const bundleIndex = firstBundleScriptIndex(html);
  const ordered = bundleIndex < 0 || sdkIndex < bundleIndex;
  record(
    'YouTube SDK loads before the game bundle',
    ordered,
    ordered ? `sdk@${sdkIndex} < bundle@${bundleIndex}` : `sdk@${sdkIndex} > bundle@${bundleIndex}`,
  );

  const hasViewport = /<meta[^>]+name=["']viewport["']/i.test(html);
  record('viewport meta present', hasViewport, hasViewport ? 'ok' : 'missing');

  // Anything that would take the player off YouTube is a submission blocker.
  const forbiddenUx = [
    { pattern: /<a\s[^>]*href=/i, label: 'outbound <a href> link' },
    { pattern: /window\.open\s*\(/i, label: 'window.open call' },
  ].filter(({ pattern }) => pattern.test(html));
  record(
    'no outbound links in index.html',
    forbiddenUx.length === 0,
    forbiddenUx.length === 0 ? 'ok' : forbiddenUx.map((f) => f.label).join(', '),
  );
}

function firstBundleScriptIndex(html: string): number {
  const scripts = [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)];
  for (const match of scripts) {
    const src = match[1] ?? '';
    if (src.includes('youtube.com')) continue;
    return match.index ?? -1;
  }
  return -1;
}

function checkAssetPaths(indexPath: string, files: string[]): void {
  if (!existsSync(indexPath)) return;
  const html = readFileSync(indexPath, 'utf8');

  // `base: './'` must hold: a leading-slash src/href resolves against the
  // Playables host root, which is not where the game lives.
  const absolute = [...html.matchAll(/\b(?:src|href)=["'](\/[^/][^"']*)["']/gi)].map(
    (m) => m[1] ?? '',
  );
  record(
    'no absolute asset paths in index.html',
    absolute.length === 0,
    absolute.length === 0 ? 'all relative' : absolute.join(', '),
  );

  const cssAbsolute: string[] = [];
  for (const file of files.filter((f) => f.endsWith('.css'))) {
    const css = readFileSync(file, 'utf8');
    for (const m of css.matchAll(/url\(\s*["']?(\/[^/)"'][^)"']*)/g)) {
      cssAbsolute.push(`${relative(DIST, file)}: ${m[1]}`);
    }
  }
  record(
    'no absolute asset paths in CSS',
    cssAbsolute.length === 0,
    cssAbsolute.length === 0 ? 'all relative' : cssAbsolute.join(', '),
  );
}

function checkForbiddenUrls(indexPath: string): void {
  const findings = [
    ...(existsSync(indexPath) ? scanFile(indexPath, 'dist/index.html', 'both') : []),
    ...scanDirectory(DIST, '.', 'both'),
  ];
  // index.html is scanned by both calls above; de-duplicate on file+line+rule.
  const unique = new Map(findings.map((f) => [`${f.file}:${f.line}:${f.rule}`, f]));
  record(
    'no forbidden URLs in build output',
    unique.size === 0,
    unique.size === 0
      ? `only ${SDK_URL} allowed — clean`
      : [...unique.values()].map((f) => `${f.file}:${f.line} ${f.message}`).join('; '),
  );

  const sourceFindings = scanDirectory('src', '.', 'source');
  record(
    'no forbidden URLs or network APIs in src/',
    sourceFindings.length === 0,
    sourceFindings.length === 0
      ? 'clean'
      : sourceFindings.map((f) => `${f.file}:${f.line} ${f.message}`).join('; '),
  );
}

function checkFileNames(files: string[]): void {
  // Conservative set: some packagers and CDNs mangle anything else.
  const invalid = files
    .map((f) => relative(DIST, f))
    .filter((name) => !/^[A-Za-z0-9._\-/]+$/.test(name) || name.includes('..'));
  record(
    'all file names are portable',
    invalid.length === 0,
    invalid.length === 0 ? `${files.length} files checked` : invalid.join(', '),
  );
}

function checkSizes(files: string[]): void {
  const sizes = files.map((f) => ({ file: relative(DIST, f), bytes: statSync(f).size }));
  const total = sizes.reduce((sum, f) => sum + f.bytes, 0);

  record(
    'file count within budget',
    files.length <= BUDGETS.fileCount,
    `${files.length} / ${BUDGETS.fileCount}`,
  );

  const oversized = sizes.filter((f) => f.bytes > BUDGETS.singleFileBytes);
  record(
    'no oversized single file',
    oversized.length === 0,
    oversized.length === 0
      ? `largest ${largest(sizes)}`
      : oversized.map((f) => `${f.file} ${mb(f.bytes)}`).join(', '),
  );

  record(
    'total build size within budget',
    total <= BUDGETS.totalBytes,
    `${mb(total)} / ${mb(BUDGETS.totalBytes)}`,
  );

  // Initial download: everything index.html references directly. With no
  // lazy-loaded assets yet this is the whole build, which the check states
  // plainly rather than pretending to measure something finer.
  const initial = initialDownloadBytes(sizes);
  record(
    'initial download within budget',
    initial <= BUDGETS.initialDownloadBytes,
    `${mb(initial)} / ${mb(BUDGETS.initialDownloadBytes)}`,
  );
}

function initialDownloadBytes(sizes: { file: string; bytes: number }[]): number {
  const indexPath = join(DIST, 'index.html');
  if (!existsSync(indexPath)) return sizes.reduce((s, f) => s + f.bytes, 0);
  const html = readFileSync(indexPath, 'utf8');
  const referenced = sizes.filter(
    (f) => f.file === 'index.html' || html.includes(f.file.split('/').pop() ?? ''),
  );
  return referenced.reduce((s, f) => s + f.bytes, 0);
}

function checkSaveSchemaSize(): void {
  // Simulates a worst-case savegame: a full board and storage at high levels,
  // three orders, boosters and stats. Phase 5 replaces this with the real
  // serializer; the budget check exists from day one so the schema can never
  // drift towards the platform limit unnoticed.
  const worstCase = {
    version: 1,
    coins: 999_999_999,
    factoryXP: 999_999_999,
    factoryRank: 10,
    prestige: 99,
    generatorLevel: 50,
    board: Array.from({ length: 30 }, (_, i) => (i % 12) + 1),
    storage: [12, 12, 12, 12],
    orders: Array.from({ length: 3 }, () => ({ i: 12, n: 3, c: 250_000, x: 1500 })),
    boosters: { magnet: 99, upgrade: 99, shuffle: 99 },
    tutorialComplete: true,
    bestScore: 999_999_999,
    stats: { merges: 999_999, orders: 99_999, spawns: 999_999, playtime: 9_999_999 },
  };
  const bytes = Buffer.byteLength(JSON.stringify(worstCase), 'utf8');
  record(
    'simulated savegame within budget',
    bytes <= BUDGETS.saveBytes,
    `${bytes} B / ${BUDGETS.saveBytes} B`,
  );
}

// --- reporting ---------------------------------------------------------

function report(): void {
  const width = Math.max(...checks.map((c) => c.name.length));
  console.log('\nYouTube Playables build validation\n');
  for (const check of checks) {
    const mark = check.status === 'PASS' ? '✔' : check.status === 'WARN' ? '!' : '✖';
    console.log(`  ${mark} ${check.name.padEnd(width)}  ${check.detail}`);
  }

  const failed = checks.filter((c) => c.status === 'FAIL');
  const warned = checks.filter((c) => c.status === 'WARN');
  console.log(
    `\n${failed.length === 0 ? 'PASS' : 'FAIL'} — ${checks.length - failed.length - warned.length} passed, ` +
      `${warned.length} warning(s), ${failed.length} failure(s)\n`,
  );
  process.exit(failed.length === 0 ? 0 : 1);
}

function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...listFiles(full));
    else out.push(full);
  }
  return out;
}

function mb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function largest(sizes: { file: string; bytes: number }[]): string {
  const top = [...sizes].sort((a, b) => b.bytes - a.bytes)[0];
  return top ? `${top.file} ${mb(top.bytes)}` : 'n/a';
}

main();
