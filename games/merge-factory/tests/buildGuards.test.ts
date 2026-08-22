import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ALLOWED_URLS, scanFile } from '../scripts/scan-forbidden-urls';

function fixture(name: string, contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'mf-scan-'));
  const path = join(dir, name);
  writeFileSync(path, contents, 'utf8');
  return path;
}

describe('forbidden URL scanner', () => {
  it('allows the YouTube SDK and nothing else', () => {
    const path = fixture(
      'index.html',
      `<script src="${ALLOWED_URLS[0]}"></script>\n` +
        '<script src="https://cdn.example.com/lib.js"></script>\n',
    );
    const findings = scanFile(path, 'index.html', 'both');
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('cdn.example.com');
  });

  it('flags remote fonts, CDNs and runtime network APIs in source', () => {
    const path = fixture(
      'bad.ts',
      [
        'const font = "https://fonts.googleapis.com/css2?family=Inter";',
        'const cdn = "//cdn.jsdelivr.net/npm/thing";',
        'await fetch("/api/score");',
        'const ws = new WebSocket(url);',
        'navigator.sendBeacon(url, data);',
      ].join('\n'),
    );
    const rules = scanFile(path, 'bad.ts').map((f) => f.rule);
    expect(rules).toContain('absolute-url');
    expect(rules).toContain('protocol-relative-url');
    expect(rules.filter((r) => r === 'network-api')).toHaveLength(3);
  });

  it('does not flag reference URLs inside comments', () => {
    const path = fixture(
      'docs.ts',
      [
        '// See https://developers.google.com/youtube/gaming/playables',
        ' * https://example.com/spec',
        'const ok = 1;',
      ].join('\n'),
    );
    expect(scanFile(path, 'docs.ts')).toHaveLength(0);
  });

  it('ignores XML namespace identifiers, which are never fetched', () => {
    const path = fixture(
      'bundle.js',
      'document.createElementNS("http://www.w3.org/2000/svg","svg");',
    );
    expect(scanFile(path, 'bundle.js', 'both')).toHaveLength(0);
  });

  it('does not flag bundled dependency network code in build output', () => {
    // Phaser ships an XHR-based loader even when the game loads no files.
    // That is not external traffic, so `both` scope must stay quiet about it.
    const path = fixture('bundle.js', 'var x = new XMLHttpRequest();');
    expect(scanFile(path, 'bundle.js', 'both')).toHaveLength(0);
    expect(scanFile(path, 'bundle.js', 'source')).toHaveLength(1);
  });

  it('reports the line number of each finding', () => {
    const path = fixture('a.ts', ['const a = 1;', 'const b = "http://evil.test/x";'].join('\n'));
    expect(scanFile(path, 'a.ts')[0]?.line).toBe(2);
  });
});
