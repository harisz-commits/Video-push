import { ICON_NAMES } from "./schema";

/**
 * Two prompts, because the job is two jobs.
 *
 * Asking for voiceover and scene list in one structured-output call failed
 * three different ways — the compiled grammar was too large, then there were
 * too many optional parameters, then the schema was "too complex" outright.
 * Structured outputs are the wrong tool for a shape this wide.
 *
 * So: the voiceover is written as plain prose, and the scenes are derived from
 * that finished text as ordinary JSON, parsed and validated here. Each call
 * produces roughly half as much output, which also halves the latency of the
 * step that kept timing out. And anchor phrases get copied out of a voiceover
 * that already exists rather than invented alongside it — the failure mode the
 * whole timing system depends on avoiding.
 */

const STYLE = `Du bist ein hochkarätiger YouTube-Scriptwriter im Stil von
"The Infographics Show". Du schreibst auf Deutsch.

STIL:
- Pacing: schnell, energiegeladen, 150 bis 170 Wörter pro Minute.
- Struktur: Start mit einer steilen, unerwarteten Behauptung. Danach Schritt
  für Schritt auflösen, warum das so ist.
- Kurze, prägnante Sätze. Rhetorische Fragen. Cliffhanger vor jedem Abschnitt.
- ANREDE: durchgehend "du". Sprich die Zuschauerin direkt an — "stell dir vor",
  "du kennst das", "das Regal, vor dem du morgen stehst". Kein "man", kein
  "wir" als Ersatz für die Anrede, kein Siezen.`;

export const VOICEOVER_SYSTEM_PROMPT = `${STYLE}

Du lieferst ausschließlich den Fließtext des Voiceovers. Kein Titel, keine
Überschriften, keine Regieanweisungen, keine Klammern, keine Sprechernamen,
keine Aufzählungen, keine Markdown-Formatierung.

VORGABEN:
- 750 bis 850 Wörter.
- Perfekte Interpunktion — der Text geht direkt in eine TTS-Engine.
- Zahlen ausgeschrieben ("vierzehneinhalb Millionen"), damit die TTS sie
  korrekt spricht.
- Absätze durch Leerzeilen trennen.`;

export function buildVoiceoverPrompt(topic: string): string {
  return `Stichwort: ${topic}

Schreibe das vollständige Voiceover für ein fünfminütiges Erklärvideo.
Antworte nur mit dem Text.`;
}

const SCENE_FIELDS = `Jede Szene hat immer:
- "type": einer von hook, counter, iconGrid, mapFlow, chain, split, chart,
  pillars, closer, narrator
- "anchorPhrase": eine Phrase von drei bis sechs Wörtern, die ZEICHENGENAU so
  im Voiceover vorkommt. Kopiere sie wörtlich heraus, inklusive Groß- und
  Kleinschreibung und Umlauten. Erfinde sie nicht und formuliere sie nicht um.
- "headline": On-Screen-Text, maximal sechs Wörter, Versalien erlaubt
- "phase": "crisis" im Problemteil, "solution" ab der Stelle, an der das Video
  in den Lösungsteil dreht. Der Wechsel darf im ganzen Video nur einmal
  passieren.
- optional "sub": zweite Zeile On-Screen-Text, kurz

Dazu je nach "type" genau diese Felder, vollständig ausgefüllt:
- hook:     optional "kicker" (kurze Zeile über der Headline)
- counter:  "values": [{"label": "...", "value": 14.5, "suffix": "Mio."}]
            ein bis drei Einträge, "suffix" optional
- iconGrid: "icon", "total" (1 bis 64), "remaining" (kleiner oder gleich total)
- mapFlow:  "region": "europe" oder "world",
            "flows": [{"from": "...", "to": "...", "label": "..."}]
- chain:    "nodes": [{"icon": "...", "label": "..."}] mindestens zwei,
            "breakAt": Index, ab dem die Kette reißt (0 bis nodes.length-1)
- split:    "panels": genau zwei [{"icon": "...", "label": "...",
            "caption": "..."}], optional "connector" (ein Icon-Name)
- chart:    "variant": "line" oder "bar", "series": [Zahlen],
            "labels": [Text] — gleich viele Einträge, mindestens zwei
- pillars:  "pillars": [Text] zwei bis sechs, "unstableIndex": Index,
            "carries": Text auf der Plattform
- closer:   "statement": der Schlusssatz
- narrator: keine zusätzlichen Felder. Eine Erzählerfigur spricht die Stelle
            lippensynchron mit; "headline" ist die Aussage neben ihr.

Lass alle Felder weg, die nicht zum Typ gehören.`;

const SCENE_RULES = `- Wiederhole denselben Typ nicht zweimal hintereinander.
- Wähle den Typ nach Inhalt, nicht nach Abwechslung. Zahlenvergleich → counter.
  Ursachenkette → chain. Zeitverlauf → chart. Gegenüberstellung → split.
  Warenströme zwischen Orten → mapFlow. Etwas verschwindet Stück für Stück
  → iconGrid. Tragende Faktoren → pillars.
- narrator setzt du dort ein, wo der Text die Zuschauerin direkt anspricht,
  eine Frage stellt oder eine Meinung zuspitzt — also da, wo kein Diagramm
  hilft, sondern jemand etwas sagt. Ungefähr jede fünfte bis sechste Szene,
  gleichmäßig verteilt, und niemals zwei hintereinander.
- Erlaubte Icon-Namen, nichts anderes: ${ICON_NAMES.join(", ")}.`;

/**
 * The scene pass runs on one slice of the voiceover at a time.
 *
 * Asking for forty to seventy scenes in a single reply took longer than the
 * function is allowed to live, and the anchor phrases came back bunched in the
 * opening paragraphs — the model front-loads when it has to cover a whole
 * script at once. A slice cannot be front-loaded: there is nothing in it but
 * the passage that needs covering, so the anchors land where they belong. The
 * slices are independent, so they run at the same time and the step costs about
 * as long as its slowest one.
 */
export const SEGMENT_SCENES_SYSTEM_PROMPT = `Du bist Video-Regisseur für
Erklärvideos im Infografik-Stil. Du bekommst einen ABSCHNITT eines fertigen
Voiceovers und legst fest, welche Szene wann einsetzt.

Antworte ausschließlich mit einem JSON-Objekt. Kein Markdown, keine Backticks,
kein Vor- oder Nachtext.

FORM:
{"scenes": [ { ... }, ... ]}

${SCENE_FIELDS}

REGELN:
- Jede anchorPhrase steht ZEICHENGENAU im ABSCHNITT — nicht im übrigen Video.
  Kopiere sie aus dem Abschnitt heraus.
- Die anchorPhrases stehen in der Reihenfolge, in der sie im Abschnitt
  vorkommen, und verteilen sich über den GANZEN Abschnitt. Die letzte Szene
  gehört in die letzten Sätze, nicht in die Mitte.
- DICHTE: alle vier bis acht Sekunden gesprochener Text eine neue Szene. Ein
  Bild, das zwanzig Sekunden steht, ist ein Fehler — lieber denselben Gedanken
  auf zwei oder drei Szenen aufteilen, die aufeinander aufbauen.
${SCENE_RULES}`;

export function buildSegmentScenesPrompt(args: {
  segment: string;
  index: number;
  total: number;
  wantScenes: number;
  isFirst: boolean;
  isLast: boolean;
  topic: string;
}): string {
  const role = args.isFirst
    ? `Das ist der ANFANG des Videos. Die allererste Szene ist "hook".`
    : args.isLast
      ? `Das ist das ENDE des Videos. Die allerletzte Szene ist "closer".`
      : `Das ist ein MITTELTEIL. Weder "hook" noch "closer" gehören hier hin.`;

  return `Thema des Videos: ${args.topic}
Abschnitt ${args.index + 1} von ${args.total}. ${role}

Abschnitt:
---
${args.segment}
---

Erzeuge ungefähr ${args.wantScenes} Szenen für genau diesen Abschnitt. Kopiere
jede anchorPhrase wörtlich aus dem Abschnitt oben heraus.`;
}

/** Short second call: a title for the finished video. */
export const TITLE_SYSTEM_PROMPT = `Du benennst YouTube-Erklärvideos. Antworte
mit dem Titel und sonst nichts — keine Anführungszeichen, kein Markdown.
Höchstens siebzig Zeichen, deutsch, zuspitzend.`;

/**
 * Feedback for the one automatic retry. We hand back the concrete failures
 * rather than a generic "das war ungültig" — a model can fix a named field and
 * cannot fix a vague complaint.
 */
export function buildRepairPrompt(problems: string[]): string {
  return `Das war noch nicht gültig. Konkret:

${problems.map((p) => `- ${p}`).join("\n")}

Antworte erneut mit dem vollständigen JSON-Objekt und behebe genau diese
Punkte. Ändere den Rest so wenig wie möglich.`;
}
