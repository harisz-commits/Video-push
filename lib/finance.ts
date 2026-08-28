import { z } from "zod";

/**
 * Das Finanz-Format: gesprochener Text über Grafiken, die aus Zahlen entstehen.
 *
 * Der Unterschied zum Video-Format ist einer, nicht viele: dort wird jedes
 * Bild von einem Modell gezeichnet und kostet Geld, hier wird jede Szene aus
 * Daten gebaut und kostet nichts. Alles andere — Recherche, Skript, Stimme,
 * Schnitt, Shorts, Untertitel, YouTube — ist dasselbe und bleibt dasselbe.
 *
 * Warum überhaupt Daten statt gezeichneter Bilder: bei Finanzinhalten IST die
 * Bewegung das Argument. Eine Zinseszinskurve, die erst flach und dann steil
 * wird, erklärt in vier Sekunden, wofür der Text vier Sätze braucht. Ein
 * gezeichnetes Bild von einer Kurve erklärt gar nichts, und ein gezeichnetes
 * Bild von einer Kurve mit falschen Zahlen erklärt etwas Falsches.
 *
 * Deshalb liefert das Modell hier keine Grafik, sondern die Zahlen darunter.
 * Gezeichnet wird in Code. Das ist auch der Grund, warum das Modell bei
 * `zinseszins` nur Rate, Laufzeit und Sparrate angibt und keine Punkte: eine
 * Zinsrechnung, die niemand nachrechnet, ist eine Behauptung.
 */

/** Wieviele Reihen ein Diagramm verträgt, bevor niemand mehr etwas erkennt. */
const MAX_SERIES = 3;
/** Wieviele Werte je Reihe. Vierzig Punkte sind vierzig Jahre. */
const MAX_POINTS = 40;
/** Zeilen in einer Gegenüberstellung, einer Tabelle, einer Aufteilung. */
const MAX_ROWS = 6;

const Label = z.string().min(1).max(60);
const Money = z.number().finite();

/**
 * Woher die Zahlen kommen, in einem Halbsatz.
 *
 * Pflicht bei jeder Szene mit Zahlen und klein im Bild sichtbar. Bei einem
 * Erklärvideo über Ägypten ist eine falsche Jahreszahl peinlich; bei einer
 * Rendite ist sie ein Schaden. Der Zwang steht hier im Schema und nicht im
 * Prompt, weil eine Bitte an ein Modell keine Zusicherung ist.
 */
const Source = z.string().min(2).max(120);

const Base = {
  /** Slug, im Projekt eindeutig. Wie bei den Bildern der Wiedererkennungspunkt. */
  key: z.string().regex(/^[a-z0-9][a-z0-9-]{2,79}$/),
  /** Kurzer deutscher Name für die Liste im Studio. */
  name: z.string().min(3).max(120),
  /** Die Überschrift im Bild. Kein Titel des Videos, sondern die Aussage. */
  headline: z.string().min(3).max(90),
  /** Eine Zeile darunter, wenn die Überschrift allein zu wenig sagt. */
  sub: z.string().max(140).optional(),
  /**
   * Ob eine Figur mit im Bild steht, und was sie tut.
   *
   * Optional und selten: eine Figur neben einem Diagramm zieht den Blick vom
   * Diagramm ab. Sie gehört dorthin, wo gerade keine Zahl erklärt wird.
   */
  figure: z.enum(["talk", "point", "shrug", "cheer", "shake"]).optional(),
};

/** Eine große Zahl mit dem, woran man sie messen kann. */
const ZahlScene = z.object({
  ...Base,
  type: z.literal("zahl"),
  value: Money,
  prefix: z.string().max(6).optional(),
  suffix: z.string().max(12).optional(),
  decimals: z.number().int().min(0).max(2).default(0),
  /** Die Bezugsgröße. Ohne sie ist eine große Zahl eine leere Zahl. */
  caption: z.string().min(3).max(140),
  source: Source,
});

/** Balken, gruppiert oder gestapelt. */
const BalkenScene = z.object({
  ...Base,
  type: z.literal("balken"),
  unit: z.string().max(16).optional(),
  /** Namen der Reihen. Eine bei einfachen Balken, mehrere bei Vergleichen. */
  series: z.array(Label).min(1).max(MAX_SERIES),
  categories: z
    .array(z.object({ label: Label, values: z.array(Money).min(1).max(MAX_SERIES) }))
    .min(2)
    .max(8),
  /** Gestapelt statt nebeneinander — für Anteile an einer Gesamtsumme. */
  stacked: z.boolean().default(false),
  source: Source,
});

/** Ein Verlauf über die Zeit, mit markierten Stellen. */
const LinieScene = z.object({
  ...Base,
  type: z.literal("linie"),
  unit: z.string().max(16).optional(),
  labels: z.array(Label).min(2).max(MAX_POINTS),
  series: z
    .array(z.object({ name: Label, points: z.array(Money).min(2).max(MAX_POINTS) }))
    .min(1)
    .max(MAX_SERIES),
  /** Krisen, Wendepunkte, Ereignisse — als Index in labels. */
  markers: z
    .array(z.object({ at: z.number().int().nonnegative(), label: Label }))
    .max(4)
    .default([]),
  source: Source,
});

/**
 * Zinseszins, aus den Parametern gerechnet statt aus gelieferten Punkten.
 *
 * Das Modell gibt Sparrate, Zinssatz und Laufzeit an — die Kurve rechnen wir.
 * Andersherum wäre es eine Behauptung, die genau dann falsch aussieht, wenn
 * jemand nachrechnet, und das tut bei Finanzinhalten jemand.
 */
const ZinseszinsScene = z.object({
  ...Base,
  type: z.literal("zinseszins"),
  /** Einmalanlage zu Beginn. */
  initial: Money.min(0).default(0),
  /** Was jeden Monat dazukommt. */
  monthly: Money.min(0).default(0),
  /** Jahreszins in Prozent, also 7 für sieben Prozent. */
  rate: z.number().min(-20).max(30),
  years: z.number().int().min(2).max(60),
  currency: z.string().max(6).default("€"),
  /** Kein Quellenzwang: die Kurve ist gerechnet, nicht behauptet. */
  source: Source.optional(),
});

/** Zwei Spalten, Zeile für Zeile. Miete gegen Kauf, ETF gegen Einzelaktie. */
const VergleichScene = z.object({
  ...Base,
  type: z.literal("vergleich"),
  left: z.object({ title: Label, rows: z.array(z.string().max(90)).min(1).max(MAX_ROWS) }),
  right: z.object({ title: Label, rows: z.array(z.string().max(90)).min(1).max(MAX_ROWS) }),
  /** Der Satz unter beiden Spalten, wenn es einen gibt. */
  verdict: z.string().max(140).optional(),
  source: Source.optional(),
});

/** Von brutto zu netto, vom Kaufpreis zu den Gesamtkosten. */
const WasserfallScene = z.object({
  ...Base,
  type: z.literal("wasserfall"),
  currency: z.string().max(6).default("€"),
  start: z.object({ label: Label, value: Money }),
  /** Positiv addiert, negativ zieht ab. */
  steps: z.array(z.object({ label: Label, delta: Money })).min(1).max(MAX_ROWS),
  endLabel: Label.default("Bleibt"),
  source: Source,
});

/** Ein Portfolio, eine Kostenstruktur, eine Aufteilung. */
const AufteilungScene = z.object({
  ...Base,
  type: z.literal("aufteilung"),
  unit: z.string().max(16).optional(),
  parts: z.array(z.object({ label: Label, value: Money.min(0) })).min(2).max(MAX_ROWS),
  /**
   * Ring statt gestapeltem Balken.
   *
   * Die Wahl trifft nicht das Modell: über vier Teile ist ein Ring unlesbar,
   * und das weiß ein Sprachmodell nicht zuverlässig. Siehe resolveAufteilung().
   */
  ring: z.boolean().optional(),
  source: Source,
});

/** Wohin das Geld geht: Gehalt, Steuer, Sparrate, Depot. */
const FlussScene = z.object({
  ...Base,
  type: z.literal("fluss"),
  currency: z.string().max(6).default("€"),
  nodes: z.array(z.object({ label: Label, value: Money.optional() })).min(2).max(5),
  source: Source.optional(),
});

/** Jahreszahlen mit Ereignissen. */
const ZeitstrahlScene = z.object({
  ...Base,
  type: z.literal("zeitstrahl"),
  events: z.array(z.object({ year: Label, label: z.string().max(90) })).min(2).max(MAX_ROWS),
  source: Source,
});

/** Zahlen nebeneinander, wenn keine Grafik sie besser zeigt. */
const TabelleScene = z.object({
  ...Base,
  type: z.literal("tabelle"),
  columns: z.array(Label).min(2).max(4),
  rows: z.array(z.array(z.string().max(40)).min(2).max(4)).min(2).max(MAX_ROWS),
  source: Source,
});

/** Eine Rechnung, Schritt für Schritt aufgebaut. */
const FormelScene = z.object({
  ...Base,
  type: z.literal("formel"),
  steps: z
    .array(z.object({ expression: z.string().max(70), note: z.string().max(80).optional() }))
    .min(2)
    .max(5),
  result: z.string().max(70).optional(),
  source: Source.optional(),
});

/**
 * Ein Satz, der stehen bleibt.
 *
 * Das Ventil für alles, was keine Zahl ist: eine Definition, ein Merksatz,
 * der Übergang zwischen zwei Kapiteln. Ohne diese Szene würde das Modell
 * anfangen, Diagramme für Aussagen zu bauen, die keine Daten haben.
 */
const AussageScene = z.object({
  ...Base,
  type: z.literal("aussage"),
  text: z.string().min(4).max(220),
  attribution: z.string().max(80).optional(),
  source: Source.optional(),
});

export const FinanceScene = z.discriminatedUnion("type", [
  ZahlScene,
  BalkenScene,
  LinieScene,
  ZinseszinsScene,
  VergleichScene,
  WasserfallScene,
  AufteilungScene,
  FlussScene,
  ZeitstrahlScene,
  TabelleScene,
  FormelScene,
  AussageScene,
]);
export type FinanceScene = z.infer<typeof FinanceScene>;
export type FinanceSceneType = FinanceScene["type"];

export const FINANCE_SCENE_TYPES = [
  "zahl",
  "balken",
  "linie",
  "zinseszins",
  "vergleich",
  "wasserfall",
  "aufteilung",
  "fluss",
  "zeitstrahl",
  "tabelle",
  "formel",
  "aussage",
] as const;

/** Wie eine Szene im Studio heißt, in einem Wort. */
export const SCENE_LABELS: Record<FinanceSceneType, string> = {
  zahl: "Große Zahl",
  balken: "Balken",
  linie: "Verlauf",
  zinseszins: "Zinseszins",
  vergleich: "Gegenüberstellung",
  wasserfall: "Wasserfall",
  aufteilung: "Aufteilung",
  fluss: "Geldfluss",
  zeitstrahl: "Zeitstrahl",
  tabelle: "Tabelle",
  formel: "Rechnung",
  aussage: "Aussage",
};

/**
 * Die Zinseszinskurve, Jahr für Jahr.
 *
 * Getrennt nach Eingezahltem und Ertrag, weil genau diese Trennung das
 * Argument ist: die Fläche zwischen den beiden Linien ist das, was der Zins
 * gemacht hat, und sie sieht in den ersten zehn Jahren nach nichts aus.
 *
 * Monatlich verzinst statt jährlich, weil monatlich eingezahlt wird — eine
 * Jahresverzinsung auf zwölf unterjährige Raten wäre um gut ein halbes
 * Prozent zu niedrig und damit genau der Fehler, den diese Szene vermeiden
 * soll.
 */
export function compoundSeries(scene: {
  initial: number;
  monthly: number;
  rate: number;
  years: number;
}): { paid: number[]; total: number[] } {
  const monthlyRate = Math.pow(1 + scene.rate / 100, 1 / 12) - 1;
  const paid: number[] = [scene.initial];
  const total: number[] = [scene.initial];
  let balance = scene.initial;

  for (let year = 1; year <= scene.years; year += 1) {
    for (let month = 0; month < 12; month += 1) {
      balance = balance * (1 + monthlyRate) + scene.monthly;
    }
    paid.push(scene.initial + scene.monthly * 12 * year);
    total.push(balance);
  }
  return { paid, total };
}

/**
 * Ring oder gestapelter Balken.
 *
 * Nicht das Modell entscheidet das. Über vier Teile werden die Segmente eines
 * Rings so schmal, dass die Beschriftung nicht mehr danebenpasst, und der
 * gestapelte Balken zeigt dasselbe ohne diesen Nachteil.
 */
export function resolveAufteilung(scene: { parts: unknown[]; ring?: boolean }): boolean {
  if (scene.parts.length > 4) return false;
  return scene.ring ?? true;
}

/**
 * Der Hinweis, der in JEDEM Finanzvideo vorkommen muss.
 *
 * Wortgleich und maschinell eingesetzt, nicht vom Modell geschrieben. Beides
 * mit Absicht: ein rechtlicher Hinweis, den ein Sprachmodell jedes Mal neu
 * formuliert, ist jedes Mal ein anderer Hinweis, und einer, um den man ein
 * Modell bittet, fehlt irgendwann. Das Skript bekommt ihn nach dem Einstieg
 * ins Thema eingefügt — gesprochen UND im Bild.
 *
 * Nach dem Einstieg und nicht als erster Satz: der erste Satz entscheidet, ob
 * weitergeschaut wird. Ein Video, das mit einem Haftungsausschluss anfängt,
 * hat keinen Zuschauer mehr, den es zu schützen gälte.
 */
export const DISCLAIMER_KEY = "hinweis-keine-anlageberatung";

/** Nach wievielen Einstellungen er kommt. */
export const DISCLAIMER_AFTER = 3;

export const DISCLAIMER_SHOTS = [
  "Kurz vorweg: Das hier ist keine Anlageberatung, sondern meine persönliche Meinung.",
  "Was du mit deinem Geld machst, entscheidest du selbst.",
] as const;

export const DISCLAIMER_SCENE: FinanceScene = {
  key: DISCLAIMER_KEY,
  name: "Hinweis: keine Anlageberatung",
  type: "aussage",
  headline: "Keine Anlageberatung",
  text: "Persönliche Meinung, keine Empfehlung. Was du mit deinem Geld machst, entscheidest du selbst.",
};

/** Ob dieses Video den Hinweis schon enthält. */
export function hasDisclaimer(project: {
  scenes: FinanceScene[];
  shots: { text: string }[];
}): boolean {
  return (
    project.scenes.some((s) => s.key === DISCLAIMER_KEY) ||
    project.shots.some((s) => /anlageberatung/i.test(s.text))
  );
}

/**
 * Den Hinweis einsetzen, falls er fehlt.
 *
 * Rein und wiederholbar, damit dasselbe beim Erzeugen und beim Nachrüsten
 * eines älteren Videos passiert. Ein vom Modell selbst geschriebener Hinweis
 * fliegt dabei raus: er stünde sonst neben unserem, mit anderem Wortlaut, und
 * zwei verschieden formulierte Haftungsausschlüsse sind schlechter als einer.
 */
export function withDisclaimer<
  S extends { id: string; text: string; image: string; motion: string },
>(project: {
  scenes: FinanceScene[];
  shots: S[];
}): { scenes: FinanceScene[]; shots: S[]; inserted: boolean } {
  if (project.scenes.some((s) => s.key === DISCLAIMER_KEY)) {
    return { ...project, inserted: false };
  }

  // Was das Modell selbst dazu geschrieben hat, kommt weg — unserer folgt.
  const kept = project.shots.filter((s) => !/anlageberatung/i.test(s.text));
  const at = Math.min(DISCLAIMER_AFTER, kept.length);
  const template = kept[0];
  if (!template) return { ...project, inserted: false };

  const added = DISCLAIMER_SHOTS.map((text, i) => ({
    ...template,
    id: `d${i + 1}`,
    text,
    image: DISCLAIMER_KEY,
    // Der Klangteppich läuft durch; ein Akzent wäre hier fehl am Platz.
    accent: undefined,
  })) as unknown as S[];

  const shots = [...kept.slice(0, at), ...added, ...kept.slice(at)].map(
    (shot, i) => ({ ...shot, id: `s${i + 1}` }),
  );

  return {
    scenes: [...project.scenes, DISCLAIMER_SCENE],
    shots,
    inserted: true,
  };
}
