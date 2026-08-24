/**
 * Zahlen, wie sie im Bild stehen sollen.
 *
 * Eigene Formatierung statt Intl mit Voreinstellungen, aus einem Grund: im
 * Render läuft ein Chromium ohne die Umgebung dieses Rechners, und eine
 * Formatierung, die sich je nach Systemsprache anders entscheidet, ist im
 * fertigen Video nicht mehr zu korrigieren. Hier steht fest, was herauskommt.
 */

const GROUP = ".";
const DECIMAL = ",";

/** 1234567.8 -> "1.234.567,8" */
export function de(value: number, decimals = 0): string {
  const negative = value < 0;
  const fixed = Math.abs(value).toFixed(decimals);
  const [whole, fraction] = fixed.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, GROUP);
  return `${negative ? "−" : ""}${grouped}${fraction ? DECIMAL + fraction : ""}`;
}

/**
 * Gekürzt, sobald eine Zahl sonst die Achse sprengt.
 *
 * Die Schwelle liegt bei zehntausend und nicht bei tausend: „8.400 €" liest
 * sich besser als „8,4 Tsd. €", und bis dorthin passt es auch nebeneinander.
 */
export function short(value: number): string {
  const abs = Math.abs(value);
  const cut = (scaled: number, unit: string) =>
    // Nachkommastelle nur, wenn sie etwas sagt: „50 Tsd." und nicht „50,0 Tsd.".
    `${de(scaled, Number.isInteger(scaled) ? 0 : 1)}${unit}`;
  if (abs >= 1_000_000_000) return cut(value / 1_000_000_000, " Mrd.");
  if (abs >= 1_000_000) return cut(value / 1_000_000, " Mio.");
  if (abs >= 10_000) return cut(value / 1000, " Tsd.");
  return de(value, Number.isInteger(value) ? 0 : 1);
}

/** Mit Einheit dahinter, wenn es eine gibt. */
export function withUnit(value: number, unit?: string): string {
  const text = short(value);
  if (!unit) return text;
  // Prozentzeichen klebt, Währungen und Wörter bekommen ein Leerzeichen.
  return unit === "%" ? `${text}%` : `${text} ${unit}`;
}

/**
 * Eine ganze Achse in einem Griff: Obergrenze, Striche, Beschriftung.
 *
 * Zusammen und nicht in drei Funktionen, weil die drei voneinander abhängen
 * und getrennt genau das produziert haben, was eine Achse unlesbar macht: eine
 * Obergrenze von 250.000 mit Strichen bei 62.500, und Beschriftungen, die auf
 * derselben Achse zwischen „4.000" und „12,0 Tsd." wechselten. Eine Achse hat
 * EINE Einheit, und die wird einmal aus der Obergrenze bestimmt.
 */
export function axis(highest: number): {
  max: number;
  ticks: number[];
  label: (value: number) => string;
} {
  if (!(highest > 0)) {
    return { max: 1, ticks: [0, 1], label: (v) => de(v) };
  }

  // Der übliche Weg: eine runde Schrittweite suchen, mit der zwischen vier und
  // sechs Striche herauskommen. Die Obergrenze folgt daraus, nicht umgekehrt.
  const magnitude = Math.pow(10, Math.floor(Math.log10(highest)));
  let step = magnitude;
  for (const candidate of [0.2, 0.25, 0.5, 1, 2, 2.5, 5, 10]) {
    step = candidate * magnitude;
    if (Math.ceil(highest / step) <= 6) break;
  }
  const count = Math.max(2, Math.ceil(highest / step));
  const max = step * count;

  const divisor =
    max >= 1_000_000_000 ? 1_000_000_000 : max >= 1_000_000 ? 1_000_000 : max >= 10_000 ? 1000 : 1;
  const suffix =
    divisor === 1_000_000_000 ? " Mrd." : divisor === 1_000_000 ? " Mio." : divisor === 1000 ? " Tsd." : "";
  // Nachkommastellen aus der Schrittweite, nicht aus dem Einzelwert: sonst
  // steht auf einer Achse „2" über „2,5".
  const decimals = Number.isInteger(step / divisor) ? 0 : 1;

  return {
    max,
    ticks: Array.from({ length: count + 1 }, (_, i) => step * i),
    label: (value) => `${de(value / divisor, decimals)}${suffix}`,
  };
}
