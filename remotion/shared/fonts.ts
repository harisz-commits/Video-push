import { loadFont } from "@remotion/fonts";
import { staticFile } from "remotion";
import { FONT } from "./Tokens";

/**
 * Self-hosted rather than loaded from Google.
 *
 * "Archivo Expanded" is not a standalone Google Fonts family and is therefore
 * not in @remotion/google-fonts — it is the Archivo variable font at width 125.
 * We ship that exact instance (plus Inter Tight and JetBrains Mono) as woff2 so
 * the renderer never depends on a network fetch mid-render.
 */
const LATIN =
  "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD";
const LATIN_EXT =
  "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF";

const FACES = [
  { family: FONT.display, file: "ArchivoExpanded-700", weight: "700" },
  { family: FONT.body, file: "InterTight-500", weight: "500" },
  { family: FONT.mono, file: "JetBrainsMono-700", weight: "700" },
] as const;

let started = false;

/**
 * Kicks off font loading exactly once. Remotion blocks the render until the
 * returned promises settle because loadFont() registers its own delayRender.
 */
export function ensureFonts(): void {
  if (started) return;
  // No-op outside a browser: Next.js server-renders the studio page and the
  // FontFace API does not exist there. The renderer and the Player both run in
  // a real Chromium, which is where the fonts actually need registering.
  if (typeof document === "undefined" || typeof FontFace === "undefined") {
    return;
  }
  started = true;

  for (const face of FACES) {
    for (const [subset, range] of [
      ["latin", LATIN],
      ["latin-ext", LATIN_EXT],
    ] as const) {
      loadFont({
        family: face.family,
        url: staticFile(`fonts/${face.file}-${subset}.woff2`),
        weight: face.weight,
        unicodeRange: range,
        format: "woff2",
        display: "block",
      }).catch((err) => {
        // A missing subset must not take down the render; the other subset
        // and the fallback stack still produce readable text.
        // eslint-disable-next-line no-console
        console.warn(`Font ${face.family} (${subset}) failed to load`, err);
      });
    }
  }
}
