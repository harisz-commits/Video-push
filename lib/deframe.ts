import sharp from "sharp";

/**
 * Den Passepartout-Rand wegschneiden, den das Bildmodell manchmal mitmalt.
 *
 * Gemini liefert eine Illustration gelegentlich nicht formatfüllend, sondern
 * wie ein aufgeklebtes Blatt: außen ein cremefarbener oder weißer Streifen,
 * manchmal noch eine dünne Rahmenlinie darum. Im fertigen Video sieht das aus
 * wie ein Fehler, weil es einer ist — die Kamerafahrt schiebt dann einen
 * weißen Balken durchs Bild.
 *
 * Der Prompt sagt inzwischen deutlich, dass die Zeichnung bis an alle vier
 * Ränder gehen soll. Das hier ist die Absicherung dahinter, denn eine
 * Anweisung an ein Bildmodell ist eine Bitte: erkannt wird der Rand am Bild
 * selbst, und was erkannt wird, wird abgeschnitten.
 *
 * Erkannt wird über die SPANNWEITE einer Zeile, nicht über ihre Farbe. Eine
 * Randzeile ist einfarbig, egal ob sie cremefarben, weiß oder eine dunkle
 * Rahmenlinie ist; eine Zeile echter Zeichnung ist es nie. Damit fallen alle
 * Varianten in dieselbe Prüfung, und eine Liste erlaubter Randfarben, die
 * beim nächsten Modell nicht mehr stimmt, entfällt.
 */

/** Wie flach eine Zeile sein muss, um als Rand zu gelten. 0–255. */
const FLAT = 14;
/**
 * Wieviel je Seite höchstens wegfällt.
 *
 * Ein Bild, dessen halber Rand verschwindet, war kein gerahmtes Bild, sondern
 * eines mit viel Himmel. Lieber ein Rand zu wenig entfernt als ein Motiv
 * angeschnitten.
 */
const MAX_SHARE = 0.22;
/** Unter dieser Breite lohnt sich das Neuschreiben der Datei nicht. */
const MIN_BORDER = 3;

/** Auf wieviel Punkte für die Messung heruntergerechnet wird. */
const PROBE = 240;

export type Deframed = {
  /** Die Datei — beschnitten, oder die ursprüngliche, wenn nichts zu tun war. */
  bytes: Buffer;
  /** Wieviel je Seite abgeschnitten wurde, in Prozent der Kantenlänge. */
  trimmed: { top: number; right: number; bottom: number; left: number };
  /** Ob überhaupt etwas geändert wurde. */
  changed: boolean;
};

export async function deframe(bytes: Buffer): Promise<Deframed> {
  const none = { top: 0, right: 0, bottom: 0, left: 0 };
  try {
    const image = sharp(bytes, { failOn: "none" });
    const meta = await image.metadata();
    if (!meta.width || !meta.height) {
      return { bytes, trimmed: none, changed: false };
    }

    // Verkleinert gemessen: der Rand ist ein grobes Merkmal, und ein
    // Vollbild in voller Auflösung durchzuzählen kostet für nichts Zeit.
    const probe = await sharp(bytes, { failOn: "none" })
      .resize(PROBE, PROBE, { fit: "fill" })
      .removeAlpha()
      .raw()
      .toBuffer();

    // Mehrfach, weil Ränder verschachtelt vorkommen: außen eine dünne dunkle
    // Rahmenlinie, darin das cremefarbene Passepartout. Ein Durchgang sieht
    // nur die äußere Farbe und bliebe an der inneren stehen.
    const crop = { top: 0, bottom: 0, left: 0, right: 0 };
    for (let pass = 0; pass < 3; pass += 1) {
      const window = {
        left: Math.round((crop.left / meta.width) * PROBE),
        top: Math.round((crop.top / meta.height) * PROBE),
        width: PROBE - Math.round(((crop.left + crop.right) / meta.width) * PROBE),
        height: PROBE - Math.round(((crop.top + crop.bottom) / meta.height) * PROBE),
      };
      if (window.width < 40 || window.height < 40) break;
      const flat = edges(probe, PROBE, PROBE, window);
      if (!flat) break;
      crop.top += Math.round((flat.top / PROBE) * meta.height);
      crop.bottom += Math.round((flat.bottom / PROBE) * meta.height);
      crop.left += Math.round((flat.left / PROBE) * meta.width);
      crop.right += Math.round((flat.right / PROBE) * meta.width);
    }

    const width = meta.width - crop.left - crop.right;
    const height = meta.height - crop.top - crop.bottom;
    const enough =
      Math.max(crop.top, crop.bottom, crop.left, crop.right) >= MIN_BORDER;
    if (!enough || width < meta.width * 0.5 || height < meta.height * 0.5) {
      return { bytes, trimmed: none, changed: false };
    }

    const out = await sharp(bytes, { failOn: "none" })
      .extract({ left: crop.left, top: crop.top, width, height })
      .toBuffer();

    return {
      bytes: out,
      trimmed: {
        top: pct(crop.top, meta.height),
        bottom: pct(crop.bottom, meta.height),
        left: pct(crop.left, meta.width),
        right: pct(crop.right, meta.width),
      },
      changed: true,
    };
  } catch {
    // Ein Bild, das sich nicht messen lässt, bleibt wie es ist. Ein fehlender
    // Beschnitt ist ein Schönheitsfehler, ein verlorenes Bild sind vier Cent.
    return { bytes, trimmed: none, changed: false };
  }
}

/**
 * Wieviele Zeilen bzw. Spalten je Seite zum Rand gehören.
 *
 * Die Prüfung hängt an den ECKEN, und das ist der Kern: ein Passepartout hat
 * vier gleiche Ecken, ein Bild mit flachem Himmel hat oben zwei helle und
 * unten zwei ganz andere. Ohne diese Bedingung wurde einem randlosen Bild
 * sechs Prozent Himmel abgeschnitten — richtig erkannt als „einfarbig",
 * falsch gedeutet als Rand.
 *
 * Deshalb auch alle vier Seiten oder keine: ein Rand umgibt, er liegt nicht
 * an einer Kante.
 */
function edges(
  rgb: Buffer,
  stride: number,
  rows: number,
  window: { left: number; top: number; width: number; height: number },
): { top: number; bottom: number; left: number; right: number } | null {
  const width = window.width;
  const height = window.height;
  const at = (x: number, y: number) =>
    lum(rgb, ((window.top + y) * stride + window.left + x) * 3);
  const corners = [
    at(1, 1),
    at(width - 2, 1),
    at(1, height - 2),
    at(width - 2, height - 2),
  ];
  const border = corners.reduce((a, b) => a + b, 0) / 4;
  if (corners.some((c) => Math.abs(c - border) > FLAT)) return null;

  const limit = {
    v: Math.floor(height * MAX_SHARE),
    h: Math.floor(width * MAX_SHARE),
  };

  const line = (
    n: number,
    get: (i: number) => number,
    length: number,
  ): boolean => {
    let lo = 255;
    let hi = 0;
    let sum = 0;
    for (let i = 0; i < length; i++) {
      const l = get(i);
      if (l < lo) lo = l;
      if (l > hi) hi = l;
      sum += l;
    }
    // Einfarbig UND in der Farbe der Ecken. Das zweite trennt den Rand von
    // einer einfarbigen Fläche mitten im Motiv.
    return hi - lo < FLAT && Math.abs(sum / length - border) < FLAT;
  };

  const walk = (
    max: number,
    flat: (n: number) => boolean,
  ): number => {
    let n = 0;
    while (n < max) {
      if (flat(n)) {
        n += 1;
        continue;
      }
      // Ein bis zwei Zeilen Übergang überspringen: zwischen Rand und
      // Zeichnung liegt eine weichgezeichnete Kante, und an ihr blieb die
      // Erkennung vorher stehen — mitten im Rand.
      if (n + 2 < max && (flat(n + 1) || flat(n + 2))) {
        n += 1;
        continue;
      }
      break;
    }
    return n;
  };

  const top = walk(limit.v, (y) => line(y, (x) => at(x, y), width));
  const bottom = walk(limit.v, (y) =>
    line(y, (x) => at(x, height - 1 - y), width),
  );
  const left = walk(limit.h, (x) => line(x, (y) => at(x, y), height));
  const right = walk(limit.h, (x) =>
    line(x, (y) => at(width - 1 - x, y), height),
  );

  // Alle vier oder keine.
  if (Math.min(top, bottom, left, right) < 1) return null;
  if (rows < 1) return null;
  return { top, bottom, left, right };
}

function lum(rgb: Buffer, i: number): number {
  return 0.299 * rgb[i] + 0.587 * rgb[i + 1] + 0.114 * rgb[i + 2];
}

function pct(px: number, of: number): number {
  return Math.round((px / of) * 1000) / 10;
}
