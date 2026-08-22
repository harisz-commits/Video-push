# Asset Sources

Every asset that ships in the build is listed here, with its origin and
licence. Nothing is fetched at runtime.

## Current state (Phase 1)

**The project contains no asset files.** No images, no audio, no fonts, no
icon sets — nothing under an `assets/` directory, because there is no such
directory.

This is deliberate, not an omission:

| Need | How it is met | Why |
|---|---|---|
| Typography | System font stack (`system-ui`, `-apple-system`, Segoe UI, Roboto, Helvetica Neue, Arial) | No webfont means no font request, ever. Nothing to license. |
| UI shapes | Drawn with Phaser `Graphics` primitives | Resolution-independent, zero bytes of payload. |
| Item art | *(Phase 2)* Procedurally drawn vector silhouettes, generated at runtime into textures | Items must be distinguishable by silhouette alone (§20); generating them keeps them consistent and costs no download. |
| Sound | *(Phase 5)* Synthesised via WebAudio oscillators and noise | Eight short cues (spawn, merge, high-level merge, order complete, coins, upgrade, button, rank up) as synthesis code, not audio files. |

## Rules for anything added later

Before any file enters this repository as an asset:

1. It must be original work created for this project, or carry a licence that
   permits commercial redistribution inside a bundled game.
2. It gets a row in the table below — file path, origin, author, licence.
3. It must not depict, imitate or reference a real brand, logo, or an
   identifiable real vehicle design (§20).
4. It must be loaded from the bundle. Never from a CDN, never from a URL.

`npm run youtube:scan` fails the build if a remote reference appears.

## Asset inventory

| File | Origin | Author | Licence |
|---|---|---|---|
| _(none yet)_ | | | |
