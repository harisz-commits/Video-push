# Merge Factory: Junkyard Empire

A merge game for [YouTube Playables](https://developers.google.com/youtube/gaming/playables).
Phaser 3 + TypeScript + Vite, no backend, no external requests, no runtime
dependencies beyond what is bundled.

> Working title. The name lives in `src/config/branding.ts` and is referenced
> from there — renaming the game is a one-line change.

**Status: Phase 1 complete** (project skeleton, platform abstraction, responsive
shell). See [PLAN.md](./PLAN.md) for the architecture, risk register and the
phase-by-phase roadmap.

---

## Quick start

```bash
npm install
npm run dev        # http://localhost:5180 — runs against LocalPlatformService
```

The game never needs YouTube to run. Outside a Playables environment it falls
back to `LocalPlatformService` automatically: localStorage saves, mock ads,
browser language, manual pause/resume.

### Dev console helpers

In `npm run dev`, `window.__mergeFactory` exposes the host behaviours that
YouTube would normally drive:

```js
__mergeFactory.pause()      // simulate ytgame onPause
__mergeFactory.resume()
__mergeFactory.mute()       // simulate host audio off
__mergeFactory.unmute()
__mergeFactory.clearSave()
__mergeFactory.state()      // current game state
```

This block is stripped from production builds.

---

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run build` | Typecheck, then production build into `dist/` |
| `npm test` | Unit tests (Vitest, node environment) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run youtube:scan` | Scan source and build for forbidden URLs / network APIs |
| `npm run youtube:validate` | Full PASS/FAIL report on `dist/` |
| `npm run smoke` | Headless browser check across six viewports (needs `npm run build` first) |
| `npm run verify` | typecheck → test → build → validate |

`npm run youtube:build` (tests → build → validate → ZIP) arrives in Phase 8.

---

## Architecture

Layers, top to bottom. Dependencies only ever point downward.

```
Scenes (Boot, Loading, Game)                    Phaser
Gameplay (board, orders, economy, progression)  plain TS, no Phaser, no DOM
Services (save, audio, ads, localization)
PlatformService  ──  LocalPlatformService
                 └─  YouTubePlatformService
```

The gameplay layer imports neither `ytgame` nor `window` nor `localStorage`.
That is what lets the merge rules, order generation and economy be tested in
milliseconds without a canvas — and what keeps a third platform adapter a
matter of adding one file.

### Directory map

| Path | Role |
|---|---|
| `src/platform/` | `PlatformService` interface and its implementations |
| `src/game/` | Phaser bootstrap, dependency container, state machine, layout solver |
| `src/scenes/` | Boot → Loading → Game |
| `src/localization/` | `LocalizationManager` and translation tables |
| `src/config/` | Branding, theme, board geometry — no numbers hardcoded in gameplay |
| `scripts/` | Build validator and the URL scanner it uses |
| `tests/` | Vitest suites |

---

## Platform contract

Every adapter guarantees the following, so gameplay never has to defend itself:

- **Nothing throws.** A missing, renamed or failing host API resolves to a
  neutral value. An unavailable ad is a normal outcome, not an error.
- **`firstFrameReady()` and `gameReady()` reach the host at most once**, no
  matter how often they are called.
- **`saveGame()` is refused until `loadGame()` has completed.** An autosave
  landing before the load returns would overwrite a real save with an empty
  board; the gate makes that impossible rather than unlikely.
- **`sendScore()` takes integers only** and swallows host rejection.

`detectPlatform()` picks the adapter from `ytgame.IN_PLAYABLES_ENV`. Anything
other than a confirmed `true` — SDK absent, blocked, still loading, or present
outside Playables — means local mode. The game always comes up.

---

## Responsive layout

`solveLayout(width, height)` is a pure function: no Phaser, no DOM, fully
tested. Cells stay square at whatever size fits both the available width and
height.

- **Portrait** stacks HUD / orders / board / generator.
- **Landscape** puts orders and the generator beside the board — the only
  arrangement where a 6-row grid survives a short, wide viewport.
- **Large screens** centre a capped content box instead of stretching.
- Safe-area insets are honoured in `index.html`; the page never scrolls.

`npm run smoke` verifies all of this in a real browser at six viewport sizes
and writes screenshots to `.smoke/`.

---

## No external traffic

The production build is allowed exactly one external URL: the YouTube
Playables SDK in `index.html`. Everything else ships in the bundle.

There are no asset files at all — no images, no audio, no fonts. Item art will
be drawn procedurally and sound synthesised via WebAudio, and the page uses a
system font stack. That is a deliberate choice: it removes the most common way
a submission picks up a stray CDN request, and it keeps the build small.

`npm run youtube:scan` enforces this over source and build output. Reference
URLs in source comments are allowed (a comment cannot make a request); bundled
dependency code paths that merely *could* use the network — Phaser ships an
XHR-based loader the game never invokes — are not flagged in build output,
since what matters there is whether any external URL is actually referenced.

---

## Testing

```bash
npm test
```

Phase 1 covers: platform adapter behaviour and failure modes, the save gate,
lifecycle-signal idempotency, host subscriptions, the state machine's
transition table, the layout solver across nine viewports, localization
fallback, and the URL scanner itself.

Merge, order, economy and ad-manager suites follow with their phases.

---

## Licensing

See [THIRD_PARTY_LICENSES.md](./THIRD_PARTY_LICENSES.md) and
[ASSET_SOURCES.md](./ASSET_SOURCES.md).
