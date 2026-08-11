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
- ANREDE: durchgehend "du", klein geschrieben. Sprich die Zuschauerin direkt
  an — "stell dir vor", "du kennst das", "das Regal, vor dem du morgen stehst".
  Imperative stehen in der Du-Form: "stell dir vor", NICHT "stellen Sie sich
  vor". "schau", NICHT "schauen Sie". Kein "man", kein "wir" als Ersatz für die
  Anrede. Die Wörter "Sie", "Ihnen", "Ihr", "Ihre" als Anrede kommen im ganzen
  Text kein einziges Mal vor.`;

/**
 * The research step, and why it exists.
 *
 * A model asked for "a real example with place and year" will produce one that
 * reads correctly and may be wrong — recalled, not looked up. Prompting cannot
 * fix that, because the failure is not disobedience: the model does not know
 * which of its own recollections are sound. The only fix is to make it look
 * things up and then forbid it from writing any number the lookup did not
 * return.
 *
 * So facts are gathered first, with web search, into a sheet the writer must
 * work from — and the sheet is kept on the job, so every number in a finished
 * video can be traced back to where it came from.
 */
export const RESEARCH_SYSTEM_PROMPT = `Du bist Faktenrechercheur für ein
Erklärvideo. Du suchst im Web und lieferst eine Faktenliste.

Antworte ausschließlich mit der Liste, ein Fakt pro Zeile, in diesem Format:
- FAKT | QUELLE

VORGABEN:
- Acht bis fünfzehn Fakten.
- Jeder Fakt, der eine Zahl oder eine Jahreszahl enthält, MUSS aus einem
  Suchergebnis stammen. Schreib nichts aus dem Gedächtnis.
- Nenne die Jahreszahl, wo es eine gibt. "im Jahr zweitausendzweiundzwanzig",
  nicht "vor ein paar Jahren".
- QUELLE ist der Name der Seite oder Organisation, von der der Fakt stammt.
- Wenn du eine Zahl nicht belegen kannst, lass den Fakt weg. Eine kurze Liste
  belegter Fakten ist besser als eine lange mit erfundenen.
- Suche gezielt nach: dem konkreten Ausmaß in Zahlen, einem realen
  historischen Ereignis mit Ort und Jahr, und den Grenzen der naheliegenden
  Lösung.`;

export function buildResearchPrompt(topic: string): string {
  return `Thema: ${topic}

Recherchiere die Fakten für ein fünfminütiges Erklärvideo zu diesem Thema.
Suche im Web. Antworte nur mit der Faktenliste.`;
}

export const VOICEOVER_SYSTEM_PROMPT = `${STYLE}

Du lieferst ausschließlich den Fließtext des Voiceovers. Kein Titel, keine
Überschriften, keine Regieanweisungen, keine Klammern, keine Sprechernamen,
keine Aufzählungen, keine Markdown-Formatierung.

AUFBAU — Trichter, in dieser Reihenfolge:
1. DOOMSDAY-HOOK (erste dreißig Sekunden, rund achtzig Wörter): Steig mit dem
   extremsten realistischen Worst Case ein, und zwar dem, der die Zuschauerin
   selbst trifft — nicht "die Weltwirtschaft", sondern das leere Regal, vor dem
   sie steht. Keine Einleitung, kein "In diesem Video". Erster Satz ist der
   Schock.
2. DEKONSTRUKTION DES ALLTAGS: Nimm etwas völlig Normales und leg die
   unsichtbare, fragile Maschinerie dahinter frei. Zerstöre die Illusion, dass
   das selbstverständlich ist.
3. BEWEIS: Ein reales, überprüfbares Beispiel aus der Vergangenheit, das zeigt,
   dass das schon passiert ist. Nenne Ort und Jahr.
4. ERWEITERUNG: Genau an der Stelle, an der die Zuschauerin denkt, sie hätte es
   verstanden — oder an eine naheliegende Lösung glaubt — nimm ihr das wieder
   weg. Die naheliegende Lösung deckt nur einen Teil des Problems ab; der Rest
   bleibt.
5. SCHLUSS: Ein Satz, der die Frage zurück an die Zuschauerin gibt.

VORGABEN:
- 750 bis 850 Wörter.
- Perfekte Interpunktion — der Text geht direkt in eine TTS-Engine.
- Dramatische Pausen entstehen durch Satzzeichen, nicht durch Regieanweisungen.
  Setz vor der Pointe einen Punkt und einen kurzen Satz dahinter. Drei Wörter,
  eigener Satz — das ist die Pause.
- Zahlen ausgeschrieben ("vierzehneinhalb Millionen"), damit die TTS sie
  korrekt spricht.
- FAKTEN: Du bekommst eine recherchierte Faktenliste. Jede Zahl und jede
  Jahreszahl in deinem Text MUSS aus dieser Liste stammen. Du erfindest keine
  Zahl, kein Jahr, keinen Ort, kein Ereignis und keine Studie — auch dann
  nicht, wenn du meinst, die Zahl zu kennen. Steht etwas nicht in der Liste,
  schreibst du es nicht. Brauchst du eine Größenordnung, für die es keinen
  Fakt gibt, formulierst du ohne Zahl ("ein Vielfaches", "der größte Teil").
  Das ist die wichtigste Regel überhaupt: ein erfundenes Detail macht das
  ganze Video wertlos.
- Absätze durch Leerzeilen trennen.`;

export function buildVoiceoverPrompt(topic: string, research: string): string {
  return `Stichwort: ${topic}

Recherchierte Fakten — deine einzige Quelle für Zahlen, Jahre, Orte und
Ereignisse:
---
${research}
---

Schreibe das vollständige Voiceover für ein fünfminütiges Erklärvideo.
Antworte nur mit dem Text.`;
}

const SCENE_FIELDS = `Jede Szene hat immer:
- "type": einer von hook, counter, iconGrid, mapFlow, chain, split, chart,
  pillars, closer, narrator, stage
- "anchorPhrase": eine Phrase von drei bis sechs Wörtern, die ZEICHENGENAU so
  im Voiceover vorkommt. Kopiere sie wörtlich heraus, inklusive Groß- und
  Kleinschreibung und Umlauten. Erfinde sie nicht und formuliere sie nicht um.
- "headline": On-Screen-Text, maximal sechs Wörter, Versalien erlaubt
- "phase": "crisis" im Problemteil, "solution" ab der Stelle, an der das Video
  in den Lösungsteil dreht. Der Wechsel darf im ganzen Video nur einmal
  passieren.
- optional "sub": zweite Zeile On-Screen-Text, kurz
- optional "sfx": EIN Geräusch, das zum INHALT der Stelle passt — nicht zur
  Grafik. "money", wenn von Geld, Preisen oder Kosten die Rede ist. "danger"
  bei Gefahr, Zusammenbruch oder Bedrohung. "drop", wenn etwas abstürzt oder
  einbricht. "reveal", wenn etwas aufgedeckt oder aufgelöst wird. Lass das
  Feld weg, wenn nichts davon zutrifft — höchstens jede dritte Szene.

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
- stage:    "cast": ein bis fünf Figuren, jede {"action": "...", "label": "..."}.
            "label" ist optional und kurz (ein bis zwei Wörter).
            Erlaubte actions: stand, walk, run, point, shake, shrug, fall,
            cheer. Optional "focusIndex": welche Figur die Szene meint.
- narrator: "action": was die Figur tut — "point" (zeigt auf die Aussage,
            wenn sie etwas behauptet), "shake" (schüttelt den Kopf bei einer
            Verneinung oder einem Irrtum), "shrug" (zuckt mit den Schultern bei
            einer offenen Frage), "talk" (redet einfach). Sonst keine Felder;
            die Figur spricht die Stelle lippensynchron mit, und "headline" ist
            die Aussage neben ihr.

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
- stage setzt du dort ein, wo der Text nicht mehr ein System beschreibt,
  sondern was das System mit MENSCHEN macht: jemand steht vor dem leeren
  Regal, alle rennen gleichzeitig los, einer bleibt liegen, eine Familie
  wartet. Zeig das Verhalten, nicht die Zahl. "run" für Panik und Ansturm,
  "fall" für Zusammenbruch, "stand" für Hilflosigkeit, "cheer" für den
  kurzen Moment, in dem es gut aussieht, "point" wenn jemand auf etwas
  aufmerksam macht. Ungefähr jede sechste bis achte Szene.
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
