#!/usr/bin/env node
/**
 * Prueft `dist/` gegen die Regeln von YouTube Playables.
 *
 * Das Bundle muss autark sein: keine Requests nach draussen, keine absoluten
 * Pfade, index.html im Root. Ein Verstoss faellt hier auf und nicht erst in
 * der Einreichung.
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(ROOT, 'dist');

/** Warnschwelle fuer die Gesamtgroesse des Bundles. */
const SIZE_WARN_MB = 25;
const TEXT_EXTENSIONS = new Set(['.html', '.js', '.mjs', '.css', '.json', '.svg']);

/**
 * Externe Referenzen. Datei-URLs und Blob/Data-URIs sind erlaubt, weil sie den
 * Container nicht verlassen.
 */
const EXTERNAL_PATTERNS = [
  { name: 'http(s) URL', regex: /\bhttps?:\/\/(?!localhost|127\.0\.0\.1)[^\s"'`)]+/g },
  { name: 'protocol-relative URL', regex: /["'(]\/\/[a-z0-9.-]+\.[a-z]{2,}/gi },
  { name: 'websocket URL', regex: /\bwss?:\/\/[^\s"'`)]+/g },
];

/**
 * Reiner Text, der keinen Request ausloest: XML-Namespaces, Lizenz- und
 * Doku-Hinweise. Praefix-Vergleich, weil diese in vielen Varianten auftreten.
 */
const ALLOWED_PREFIXES = [
  'http://www.w3.org/',
  'https://www.w3.org/',
  'http://www.khronos.org/',
  'https://opensource.org/',
  'https://github.com/BabylonJS',
  'https://doc.babylonjs.com',
  'https://babylonjs.com',
];

/**
 * Standardwerte von Babylon-Subsystemen, die dieses Spiel nicht benutzt.
 * Sie stehen als Konstante im Bundle, werden aber von keinem erreichbaren
 * Codepfad gelesen — es gibt weder KTX2-/EXR-Texturen noch Snippet- oder
 * Script-Nachladen.
 *
 * Bewusst EXAKTE Treffer, kein Praefix: taucht eine neue Babylon-Version mit
 * einer anderen URL auf oder schleicht sich ein echter Aufruf ein, faellt das
 * hier auf, statt still durchzurutschen. Jeder Eintrag braucht eine Quelle.
 */
const INERT_THIRD_PARTY_DEFAULTS = new Map([
  ['https://cdn.babylonjs.com', 'Tools._DefaultCdnUrl — nur fuer Tools.LoadScript'],
  ['https://assets.babylonjs.com/core', 'Tools._DefaultAssetsUrl — nur fuer Beispiel-Assets'],
  [
    'https://cdn.babylonjs.com/babylon.ktx2Decoder.js',
    'KhronosTextureContainer2.URLConfig — KTX2-Texturen werden nicht geladen',
  ],
  ['https://unpkg.com/fflate@0.8.2', 'EXR-Loader-Konfiguration — EXR wird nicht geladen'],
  ['https://snippet.babylonjs.com', 'SnippetUrl — Snippet-Server wird nicht benutzt'],
]);

const errors = [];
const warnings = [];
const notices = [];

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else out.push(full);
  }
  return out;
}

function checkExternalReferences(relPath, content) {
  for (const { name, regex } of EXTERNAL_PATTERNS) {
    for (const match of content.matchAll(regex)) {
      const hit = match[0];
      if (ALLOWED_PREFIXES.some((allowed) => hit.startsWith(allowed))) continue;

      const reason = INERT_THIRD_PARTY_DEFAULTS.get(hit);
      if (reason) {
        notices.push(`${relPath}: inert default ${hit} (${reason})`);
        continue;
      }
      errors.push(`${relPath}: external ${name} -> ${hit.slice(0, 120)}`);
    }
  }
}

function checkAbsolutePaths(relPath, content) {
  // In HTML duerfen src/href nicht mit "/" beginnen — im Playables-Container
  // liegt das Spiel nicht im Server-Root.
  for (const match of content.matchAll(/\b(?:src|href)\s*=\s*"(\/[^/][^"]*)"/g)) {
    errors.push(`${relPath}: absolute path in markup -> ${match[1]}`);
  }
}

function checkNetworkApis(relPath, content) {
  // fetch/XHR sind nicht grundsaetzlich verboten, aber in einem Spiel ohne
  // Backend ein starkes Indiz fuer einen versehentlichen Aufruf.
  for (const api of ['XMLHttpRequest', 'navigator.sendBeacon']) {
    if (content.includes(api)) {
      warnings.push(`${relPath}: references ${api} — verify no runtime network call`);
    }
  }
}

async function main() {
  if (!existsSync(DIST)) {
    console.error('✗ dist/ not found — run "npm run build" first.');
    process.exit(1);
  }

  const files = await walk(DIST);

  if (!existsSync(join(DIST, 'index.html'))) {
    errors.push('index.html is missing from the build root');
  }

  let totalBytes = 0;
  for (const file of files) {
    const rel = relative(DIST, file);
    totalBytes += (await stat(file)).size;
    if (!TEXT_EXTENSIONS.has(extname(file))) continue;

    const content = await readFile(file, 'utf8');
    checkExternalReferences(rel, content);
    checkNetworkApis(rel, content);
    if (extname(file) === '.html') checkAbsolutePaths(rel, content);
  }

  const totalMb = totalBytes / (1024 * 1024);
  if (totalMb > SIZE_WARN_MB) {
    warnings.push(`bundle is ${totalMb.toFixed(1)} MB (soft limit ${SIZE_WARN_MB} MB)`);
  }

  console.log(`Checked ${files.length} files · ${totalMb.toFixed(2)} MB total`);
  for (const notice of notices) console.log(`· ${notice}`);
  for (const warning of warnings) console.warn(`⚠ ${warning}`);

  if (errors.length > 0) {
    for (const error of errors) console.error(`✗ ${error}`);
    console.error(`\n${errors.length} YouTube Playables compliance error(s).`);
    process.exit(1);
  }

  console.log('✓ Build is self-contained and Playables-compatible.');
}

await main();
