/**
 * Guards the "no external traffic" rule (briefing §30).
 *
 * Scans source and/or a built `dist` for anything that could reach the network
 * at runtime. Exactly one external URL is allowed: the YouTube Playables SDK.
 *
 * Run standalone:  npm run youtube:scan
 * Used by:         scripts/validate-youtube-build.ts
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

/** The only URL the shipped game is allowed to reference. */
export const ALLOWED_URLS = ['https://www.youtube.com/game_api/v1'];

/**
 * XML/SVG namespace identifiers. They look like URLs but are never fetched —
 * they are constants passed to `createElementNS`. Phaser contains several.
 */
const INERT_URL_PREFIXES = ['http://www.w3.org/', 'https://www.w3.org/'];

/** Text files worth scanning. Binary assets are checked by size, not content. */
const SCANNABLE = new Set(['.ts', '.js', '.mjs', '.cjs', '.html', '.css', '.json', '.map']);

const SKIP_DIRS = new Set(['node_modules', '.git', 'release', '.vite']);

/**
 * `source` rules run on our own code only. Bundled dependencies legitimately
 * contain unused network code paths (Phaser's asset loader uses XHR even when
 * the game loads no files), so flagging them in `dist` would be noise. What
 * actually matters in `dist` is whether any external URL is referenced — that
 * rule runs everywhere.
 */
type RuleScope = 'source' | 'both';

interface Rule {
  id: string;
  pattern: RegExp;
  message: string;
  scope: RuleScope;
}

const RULES: Rule[] = [
  {
    id: 'absolute-url',
    pattern: /\bhttps?:\/\/[^\s"'`)\]}<>]+/g,
    message: 'absolute URL',
    scope: 'both',
  },
  {
    id: 'protocol-relative-url',
    pattern: /(?<![:\w])\/\/(?:cdn|unpkg|jsdelivr|fonts|ajax)[\w.-]*\//g,
    message: 'protocol-relative CDN URL',
    scope: 'both',
  },
  {
    id: 'network-api',
    pattern: /\b(?:fetch\s*\(|new\s+XMLHttpRequest|new\s+WebSocket|navigator\.sendBeacon)/g,
    message: 'runtime network API',
    scope: 'source',
  },
  {
    id: 'remote-font',
    pattern: /@import\s+url\(/g,
    message: 'CSS @import (may pull a remote stylesheet)',
    scope: 'both',
  },
];

export interface Finding {
  file: string;
  line: number;
  rule: string;
  message: string;
  excerpt: string;
}

export function scanDirectory(
  root: string,
  baseForDisplay = root,
  scope: RuleScope = 'source',
): Finding[] {
  const findings: Finding[] = [];
  walk(root, (file) => {
    if (!SCANNABLE.has(extname(file))) return;
    findings.push(...scanFile(file, relative(baseForDisplay, file) || file, scope));
  });
  return findings;
}

export function scanFile(
  absolutePath: string,
  displayName: string,
  scope: RuleScope = 'source',
): Finding[] {
  const findings: Finding[] = [];
  const lines = readFileSync(absolutePath, 'utf8').split('\n');
  const rules = RULES.filter((rule) => scope === 'source' || rule.scope === 'both');

  lines.forEach((line, index) => {
    // A URL inside a comment cannot produce a request; reference links in
    // source comments stay legal. Network APIs are still flagged either way.
    const commentOnly = isCommentLine(line);

    for (const rule of rules) {
      rule.pattern.lastIndex = 0;
      for (const match of line.matchAll(rule.pattern)) {
        const hit = match[0];
        if (rule.id === 'absolute-url') {
          if (commentOnly || isAllowedUrl(hit) || isInertUrl(hit)) continue;
        }
        findings.push({
          file: displayName,
          line: index + 1,
          rule: rule.id,
          message: `${rule.message}: ${truncate(hit, 90)}`,
          excerpt: truncate(line.trim(), 120),
        });
      }
    }
  });

  return findings;
}

function isAllowedUrl(url: string): boolean {
  return ALLOWED_URLS.some((allowed) => url.startsWith(allowed));
}

function isInertUrl(url: string): boolean {
  return INERT_URL_PREFIXES.some((prefix) => url.startsWith(prefix));
}

function isCommentLine(line: string): boolean {
  const trimmed = line.trim();
  return (
    trimmed.startsWith('//') ||
    trimmed.startsWith('*') ||
    trimmed.startsWith('/*') ||
    trimmed.startsWith('<!--')
  );
}

function walk(dir: string, onFile: (path: string) => void): void {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, onFile);
    else onFile(full);
  }
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

// --- CLI ---------------------------------------------------------------

const isMain = process.argv[1]?.endsWith('scan-forbidden-urls.ts');
if (isMain) {
  const targets = ['src', 'index.html', 'dist'].filter(exists);
  const findings: Finding[] = [];

  for (const target of targets) {
    const scope: RuleScope = target === 'dist' ? 'both' : 'source';
    findings.push(
      ...(statSync(target).isDirectory()
        ? scanDirectory(target, '.', scope)
        : scanFile(target, target, scope)),
    );
  }

  if (findings.length === 0) {
    console.log(`✔ no forbidden URLs or network APIs in: ${targets.join(', ')}`);
    process.exit(0);
  }

  console.error(`✖ ${findings.length} finding(s):\n`);
  for (const f of findings) {
    console.error(`  ${f.file}:${f.line}  [${f.rule}] ${f.message}`);
    console.error(`      ${f.excerpt}`);
  }
  process.exit(1);
}

function exists(path: string): boolean {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
}
