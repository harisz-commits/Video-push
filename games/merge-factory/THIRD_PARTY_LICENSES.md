# Third-Party Licenses

Dependencies whose code ships inside the production bundle, plus the one
external script the game loads at runtime.

## Bundled at runtime

### Phaser 3

- Version: 3.90.0
- Homepage: https://phaser.io
- Licence: MIT
- Copyright © 2013–2025 Phaser Studio Inc.

The full MIT text ships with the package at `node_modules/phaser/license.txt`.

Phaser is the only runtime dependency. It is bundled into the build output;
nothing is loaded from a CDN.

## Loaded by the host

### YouTube Playables SDK

- URL: `https://www.youtube.com/game_api/v1`
- Provided and governed by YouTube / Google

Required by the platform and referenced from `index.html`. It is the only
external URL the production build is permitted to contain. It is not
redistributed with the game and is not covered by this project's licence.

## Build-time only (not shipped)

These appear in `devDependencies` and never reach the bundle:

| Package | Licence |
|---|---|
| vite | MIT |
| vitest | MIT |
| typescript | Apache-2.0 |
| tsx | MIT |
| playwright | Apache-2.0 |
| @types/node | MIT |

## Assets

None. See [ASSET_SOURCES.md](./ASSET_SOURCES.md) — the game ships no image,
audio or font files, so no asset licences apply.
