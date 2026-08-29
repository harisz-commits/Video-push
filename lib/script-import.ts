/**
 * Ein selbst geschriebenes Skript übernehmen, ohne ein Wort daran zu ändern.
 *
 * Der Punkt dieses Moduls ist eine Zusage, und sie ist technischer Natur: was
 * hier hineingeht, kommt Zeichen für Zeichen wieder heraus. Das Modell wird
 * NICHT gebeten, den Text zu formatieren, zu kürzen oder zu glätten — es
 * bekommt die fertig nummerierten Sätze und darf ausschließlich sagen, welche
 * Grafik zu welchen Sätzen gehört.
 *
 * Wäre es anders herum — Text rein, Text raus — würde das Modell umschreiben.
 * Nicht aus Ungehorsam, sondern weil Umschreiben das ist, was es tut. Die
 * einzige verlässliche Art, einen Text unangetastet zu lassen, ist, ihn dem
 * Modell gar nicht erst zurückschreiben zu lassen.
 */

/** Kürzel, nach deren Punkt KEIN Satz endet. */
const ABBREVIATIONS = [
  "z.b",
  "u.a",
  "d.h",
  "v.a",
  "s.o",
  "s.u",
  "ca",
  "bzw",
  "inkl",
  "exkl",
  "evtl",
  "ggf",
  "max",
  "min",
  "mind",
  "nr",
  "abs",
  "art",
  "vgl",
  "etc",
  "usw",
  "bspw",
  "dr",
  "prof",
  "hr",
  "fr",
  "st",
  "bzgl",
  "sog",
  "jhd",
  "jh",
  "mio",
  "mrd",
  "tsd",
  "eur",
  "chf",
  "kg",
  "km",
  "qm",
];

/**
 * Ein Skript in Sätze zerlegen.
 *
 * Nur an Satzzeichen, gefolgt von Leerraum und einem Großbuchstaben oder
 * einer Ziffer. Was NICHT trennt: der Punkt in „z. B.", in „1.000", in
 * „3,5 %", in einer Jahreszahl mit Punkt, in einer Abkürzung, und ein Punkt
 * am Ende einer Zeile, wenn danach kleingeschrieben weitergeht.
 *
 * Absätze im Ausgangstext trennen immer — wer im eigenen Skript eine Leerzeile
 * setzt, meint einen Einschnitt.
 */
export function splitScript(raw: string): string[] {
  const text = raw.replace(/\r\n?/g, "\n").trim();
  if (!text) return [];

  const out: string[] = [];
  for (const block of text.split(/\n\s*\n+/)) {
    // Einzelne Zeilenumbrüche innerhalb eines Absatzes sind Umbrüche des
    // Schreibprogramms, keine Satzgrenzen.
    const flat = block.replace(/\s*\n\s*/g, " ").trim();
    if (!flat) continue;

    let start = 0;
    for (let i = 0; i < flat.length; i += 1) {
      if (!".!?…".includes(flat[i])) continue;

      // Mehrere Satzzeichen am Stück gehören zusammen: „Wirklich?!"
      let end = i;
      while (end + 1 < flat.length && ".!?…".includes(flat[end + 1])) end += 1;

      const after = flat.slice(end + 1);
      // Ein schließendes Anführungszeichen oder eine Klammer gehört noch zum Satz.
      const trailing = /^["»“”')\]]+/.exec(after)?.[0] ?? "";
      const rest = after.slice(trailing.length);

      if (!/^\s/.test(rest) && rest.length > 0) continue;
      // Danach muss etwas Neues anfangen: Großbuchstabe, Ziffer oder Zitat.
      if (rest.length > 0 && !/^\s+[A-ZÄÖÜ0-9„"»(]/.test(rest)) continue;
      if (flat[i] === "." && endsInAbbreviation(flat.slice(start, i))) continue;
      // „1.000" und „2007." mitten in einer Zahl.
      if (
        flat[i] === "." &&
        /\d$/.test(flat.slice(0, i)) &&
        /^\s*\d/.test(rest)
      ) {
        continue;
      }

      const sentence = flat.slice(start, end + 1 + trailing.length).trim();
      if (sentence) out.push(sentence);
      start = end + 1 + trailing.length;
      i = start - 1;
    }

    const tail = flat.slice(start).trim();
    if (tail) out.push(tail);
  }
  return out;
}

function endsInAbbreviation(before: string): boolean {
  const word = /([A-Za-zÄÖÜäöüß.]+)$/.exec(before)?.[1] ?? "";
  const bare = word.replace(/\.$/, "").toLowerCase();
  if (!bare) return false;
  // Ein einzelner Buchstabe vor dem Punkt ist fast immer eine Initiale
  // oder der zweite Teil von „z. B." — nie ein Satzende.
  if (bare.length === 1) return true;
  return (
    ABBREVIATIONS.includes(bare) ||
    ABBREVIATIONS.includes(bare.replace(/\./g, ""))
  );
}

/**
 * Der Beweis, dass nichts verändert wurde.
 *
 * Vergleicht das Original mit den aneinandergehängten Sätzen, nachdem beide
 * auf ihre Zeichen reduziert wurden — Leerraum zählt nicht, weil das Zerlegen
 * ihn zwangsläufig anfasst. Alles andere muss gleich sein.
 *
 * Nicht als Zierat: dieses Modul verspricht, den Text nicht anzurühren, und
 * ein Versprechen ohne Prüfung ist eine Absicht.
 */
export function textIsUnchanged(
  original: string,
  sentences: string[],
): boolean {
  const bare = (s: string) => s.replace(/\s+/g, "");
  return bare(original) === bare(sentences.join(""));
}

/** Was beim Zerlegen herauskam, für die Anzeige im Studio. */
export function describeSplit(sentences: string[]): {
  sentences: number;
  words: number;
  minutes: number;
} {
  const words = sentences.reduce(
    (n, s) => n + s.trim().split(/\s+/).filter(Boolean).length,
    0,
  );
  return {
    sentences: sentences.length,
    words,
    // Dieselbe Sprechgeschwindigkeit, mit der die Skripte geplant werden.
    minutes: Math.round((words / 160) * 10) / 10,
  };
}
