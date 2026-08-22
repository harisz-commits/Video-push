/**
 * Headless responsiveness + cleanliness check for a built `dist`.
 *
 * Serves the build locally, loads it at several real viewport sizes and
 * asserts the things §27 and §30 care about but a unit test cannot see:
 * the canvas exists, the page never scrolls, no uncaught errors, and no
 * request leaves for anywhere except the YouTube SDK.
 *
 * Screenshots land in `.smoke/` for eyeballing.
 *
 *   npm run build && npm run smoke
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';

const DIST = process.argv[2] ?? 'dist';
const OUT = '.smoke';
const PORT = 4321;
const ALLOWED_EXTERNAL = 'https://www.youtube.com/game_api/v1';

const VIEWPORTS = [
  ['portrait-390x844', 390, 844],
  ['landscape-844x390', 844, 390],
  ['small-320x568', 320, 568],
  ['tablet-768x1024', 768, 1024],
  ['desktop-1440x900', 1440, 900],
  ['ultrawide-2560x720', 2560, 720],
];

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

if (!existsSync(DIST)) {
  console.error(`✖ ${DIST}/ not found. Run \`npm run build\` first.`);
  process.exit(1);
}
mkdirSync(OUT, { recursive: true });

const server = createServer((req, res) => {
  const requested = join(DIST, decodeURIComponent((req.url ?? '/').split('?')[0]));
  const file = existsSync(requested) && extname(requested) ? requested : join(DIST, 'index.html');
  res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' });
  res.end(readFileSync(file));
});
await new Promise((resolve) => server.listen(PORT, resolve));

const browser = await chromium.launch({
  // Set CHROMIUM_PATH when the environment ships a browser Playwright did not
  // download itself; otherwise Playwright resolves its own.
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

const failures = [];
const externalRequests = new Set();

for (const [name, width, height] of VIEWPORTS) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (r) => {
    const url = r.url();
    if (!url.startsWith(`http://localhost:${PORT}`)) externalRequests.add(url);
  });

  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: join(OUT, `${name}.png`) });

  const info = await page.evaluate(() => ({
    canvases: document.querySelectorAll('canvas').length,
    preloaderGone: !document.getElementById('preloader'),
    horizontalScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    verticalScroll: document.documentElement.scrollHeight > document.documentElement.clientHeight,
  }));

  const issues = [];
  if (info.canvases !== 1) issues.push(`expected 1 canvas, got ${info.canvases}`);
  if (!info.preloaderGone) issues.push('preloader was never removed');
  if (info.horizontalScroll) issues.push('page scrolls horizontally');
  if (info.verticalScroll) issues.push('page scrolls vertically');
  if (errors.length) issues.push(`page errors: ${errors.join(' | ')}`);

  console.log(`  ${issues.length ? '✖' : '✔'} ${name}${issues.length ? ` — ${issues.join('; ')}` : ''}`);
  if (issues.length) failures.push(name);

  await page.close();
}

const disallowed = [...externalRequests].filter((u) => !u.startsWith(ALLOWED_EXTERNAL));
console.log(
  `\n  ${disallowed.length ? '✖' : '✔'} external requests: ` +
    (disallowed.length ? disallowed.join(', ') : `only ${ALLOWED_EXTERNAL}`),
);
if (disallowed.length) failures.push('external-requests');

await browser.close();
server.close();

console.log(`\n${failures.length ? 'FAIL' : 'PASS'} — screenshots in ${OUT}/\n`);
process.exit(failures.length ? 1 : 0);
