/**
 * German names for the languages ElevenLabs reports.
 *
 * The API answers in English — "German", "Turkish", "Japanese" — and those
 * words would end up on screen as the answer options of a German video, which
 * is absurd on its face: a viewer being asked to recognise German would be
 * offered "German" as the answer.
 *
 * A lookup rather than a translation call: it is deterministic, free, and the
 * fallback is harmless. A language not listed here shows the name ElevenLabs
 * gave it, which is wrong in style but never wrong in fact — unlike a
 * hardcoded list of *which* languages exist, this one cannot hide a capability.
 */
const GERMAN: Record<string, string> = {
  ar: "Arabisch",
  bg: "Bulgarisch",
  cs: "Tschechisch",
  da: "Dänisch",
  de: "Deutsch",
  el: "Griechisch",
  en: "Englisch",
  es: "Spanisch",
  fi: "Finnisch",
  fil: "Filipino",
  fr: "Französisch",
  hi: "Hindi",
  hr: "Kroatisch",
  id: "Indonesisch",
  it: "Italienisch",
  ja: "Japanisch",
  ko: "Koreanisch",
  ms: "Malaiisch",
  nl: "Niederländisch",
  pl: "Polnisch",
  pt: "Portugiesisch",
  ro: "Rumänisch",
  ru: "Russisch",
  sk: "Slowakisch",
  sv: "Schwedisch",
  ta: "Tamil",
  tr: "Türkisch",
  uk: "Ukrainisch",
  zh: "Chinesisch",
};

export function germanName(id: string, fallback: string): string {
  return GERMAN[id] ?? fallback;
}
