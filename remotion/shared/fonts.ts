import { loadFont } from "@remotion/fonts";
import {
  ArchivoExpanded700latin,
  ArchivoExpanded700latinExt,
  InterTight500latin,
  InterTight500latinExt,
  JetBrainsMono700latin,
  JetBrainsMono700latinExt,
} from "./fontData";
import { FONT } from "./Tokens";

/**
 * Self-hosted and inlined.
 *
 * "Archivo Expanded" is not a standalone Google Fonts family and is therefore
 * not in @remotion/google-fonts — it is the Archivo variable font at width 125.
 * We ship that exact instance, plus Inter Tight and JetBrains Mono.
 *
 * They arrive as data URIs rather than files: a render failed in the Vercel
 * sandbox on delayRender() waiting for /public/fonts/…, because staticFile()
 * resolves differently there than in a local render. Embedding removes both
 * the path and the request, so the fonts cannot fail to arrive in one
 * environment and succeed in another.
 */
const LATIN =
  "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD";
const LATIN_EXT =
  "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF";

const FACES = [
  { family: FONT.display, weight: "700", latin: ArchivoExpanded700latin, ext: ArchivoExpanded700latinExt },
  { family: FONT.body, weight: "500", latin: InterTight500latin, ext: InterTight500latinExt },
  { family: FONT.mono, weight: "700", latin: JetBrainsMono700latin, ext: JetBrainsMono700latinExt },
] as const;

let started = false;

/**
 * Registers the fonts exactly once.
 *
 * Called from inside the component, not at module scope: at import time
 * Remotion's rendering context does not exist yet, and anything derived from
 * it resolves against the wrong root.
 */
export function ensureFonts(): void {
  if (started) return;
  if (typeof document === "undefined" || typeof FontFace === "undefined") {
    return;
  }
  started = true;

  for (const face of FACES) {
    for (const [url, range] of [
      [face.latin, LATIN],
      [face.ext, LATIN_EXT],
    ] as const) {
      void loadFont({
        family: face.family,
        url,
        weight: face.weight,
        unicodeRange: range,
        format: "woff2",
        display: "block",
      });
    }
  }
}
