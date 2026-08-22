#!/usr/bin/env node
/**
 * Manueller Browser-Smoketest: Menue -> Run -> Steuerung -> Ergebnis -> Menue.
 *
 * Prueft nebenbei die harte Playables-Regel: waehrend des gesamten Durchlaufs
 * darf keine einzige Anfrage den eigenen Origin verlassen.
 *
 * Playwright ist bewusst KEINE Projektabhaengigkeit — der Test laeuft selten
 * und von Hand:
 *
 *   npm run build && npm run preview -- --port 4173 &
 *   npx playwright@latest install chromium   # falls noch nicht vorhanden
 *   node scripts/smoke.mjs http://localhost:4173 ./tmp-shots
 *
 * Mit PW_CHROMIUM=<pfad> laesst sich ein bereits installiertes Chromium
 * verwenden.
 */

import { chromium } from 'playwright';

const BASE = process.argv[2] ?? 'http://localhost:4173';
const OUT = process.argv[3] ?? '/tmp/shot';

const browser = await chromium.launch({
  ...(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}),
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 430, height: 860 } });

const logs = [];
const failures = [];
page.on('console', (m) => logs.push(`${m.type()}: ${m.text()}`));
page.on('pageerror', (e) => failures.push(`pageerror: ${e.message}`));
page.on('requestfailed', (r) => failures.push(`requestfailed: ${r.url()}`));

// Jede Anfrage nach draussen protokollieren - Playables-Compliance.
const external = [];
await page.route('**/*', (route) => {
  const url = route.request().url();
  if (!url.startsWith(BASE) && !url.startsWith('data:') && !url.startsWith('blob:')) {
    external.push(url);
  }
  return route.continue();
});

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
await page.screenshot({ path: `${OUT}-menu.png` });

const menuVisible = await page.locator('.menu-title').isVisible();
const splashHidden = await page.locator('#boot-splash.hidden').count();

// Survival starten und steuern.
await page.getByRole('button', { name: 'Survival Run' }).click();
await page.waitForTimeout(700);
const box = await page.locator('#render-canvas').boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.7);
await page.mouse.down();
await page.mouse.move(box.x + box.width * 0.15, box.y + box.height * 0.7, { steps: 20 });
await page.waitForTimeout(900);
await page.screenshot({ path: `${OUT}-run-left.png` });
await page.mouse.move(box.x + box.width * 0.9, box.y + box.height * 0.7, { steps: 25 });
await page.waitForTimeout(1200);
await page.mouse.up();
await page.screenshot({ path: `${OUT}-run-right.png` });

const hudTime = await page.locator('.hud-time').textContent();
const hudSector = await page.locator('.hud-sector').textContent();

// FPS ueber zwei Sekunden messen.
const fps = await page.evaluate(
  () =>
    new Promise((resolve) => {
      let frames = 0;
      const start = performance.now();
      const tick = () => {
        frames += 1;
        if (performance.now() - start < 2000) requestAnimationFrame(tick);
        else resolve(Math.round((frames * 1000) / (performance.now() - start)));
      };
      requestAnimationFrame(tick);
    }),
);

await page.getByRole('button', { name: 'End run' }).click();
await page.waitForTimeout(600);
await page.screenshot({ path: `${OUT}-results.png` });
const resultsVisible = await page.locator('.results-title').isVisible();

// Zurueck ins Menue und pruefen, dass der Spielstand geschrieben wurde.
await page.getByRole('button', { name: 'Continue' }).click();
await page.waitForTimeout(800);
const saved = await page.evaluate(() =>
  window.localStorage.getItem('last-stand-zombie-front:save'),
);

await browser.close();

console.log(JSON.stringify({
  menuVisible, splashHidden, hudTime, hudSector, fps, resultsVisible,
  saved: saved ? JSON.parse(saved) : null,
  external, failures,
  logs: logs.slice(0, 20),
}, null, 2));
