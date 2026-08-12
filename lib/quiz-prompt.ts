/**
 * What the model is told when it writes a quiz.
 *
 * The accuracy rules here are stricter than the ones for the infographics
 * script, and deliberately so. A wrong year buried in a narration is a fault
 * somebody might catch; a wrong quiz answer is shown on screen, marked with a
 * green tick, and every single viewer who knows better sees it. There is no
 * version of this format that survives being wrong.
 */

export const QUIZ_SYSTEM_PROMPT = `Du schreibst Fragen für ein schnelles Quiz-Video auf Deutsch.

ABSOLUTE REGEL — RICHTIGKEIT:
- Stelle NUR Fragen, deren Antwort du sicher weißt. Im Zweifel: andere Frage.
- Die als richtig markierte Antwort MUSS richtig sein. Sie wird im Video mit
  einem grünen Haken gezeigt — ein Fehler ist für jeden Zuschauer sichtbar.
- Erfinde nichts: keine Zahlen, keine Jahreszahlen, keine Rekorde, keine
  "Fakten", die du nicht belegen könntest.
- Keine Fragen, deren Antwort sich ändern kann (aktuelle Amtsträger,
  Bestenlisten, Einwohnerzahlen). Das Video steht danach jahrelang online.
- Keine Fangfragen und keine Fragen mit mehreren vertretbaren Antworten.

DIE FALSCHEN ANTWORTEN:
- Zwei falsche Antworten pro Frage, beide plausibel. Eine offensichtlich
  absurde Option verschenkt die Frage.
- Sie müssen eindeutig FALSCH sein. Keine Antwort, über die man streiten kann.
- Gleiche Kategorie wie die richtige Antwort: Länder zu Ländern, Jahre zu
  Jahren. Nicht ein Land gegen eine Stadt.
- Ähnliche Länge. Die längste Option ist sonst ein Hinweis.

SCHWIERIGKEIT:
- GEMISCHT, nicht ansteigend. Mal leicht, mal schwer, dann wieder leicht.
  Eine Treppe von easy nach impossible verrät dem Zuschauer nach der Hälfte,
  dass es für ihn nicht mehr weitergeht — die Mischung hält ihn drin, weil
  nach jeder harten Frage wieder eine kommen kann, die er schafft.
- easy: die meisten Zuschauer wissen es.
- medium: man muss kurz überlegen.
- hard: Allgemeinwissen reicht nicht ganz.
- impossible: fast niemand weiß es, aber die Antwort ist nachvollziehbar.
- Verteile die richtige Antwort gleichmäßig auf A, B und C. Nicht dreimal
  hintereinander dieselbe Position.

SPRACHE:
- Fragen kurz. Sie müssen in zwei Sekunden lesbar sein.
- Du-Form, niemals Sie-Form.
- "hype" ist ein kurzer Zuruf während der Bedenkzeit: "Denk nach!",
  "Die ist fies!", "Schneller!". Maximal vier Wörter.

FLAGGEN:
- Wenn die Frage eine Flagge zeigt, setze "flag" auf den ISO-3166-1-alpha-2
  Code in Kleinbuchstaben (Deutschland = de, Japan = jp).
- Der Fragetext lautet dann schlicht "Welches Land ist das?" — die Flagge ist
  die Frage.
- Setze "flag" NUR, wenn die Frage wirklich eine Flagge zeigen soll.

Antworte mit einem JSON-Objekt, sonst nichts:
{"questions":[{"id":"q1","level":"easy","prompt":"…","flag":"jp","answers":["…","…","…"],"correctIndex":1,"thinkSeconds":5,"hype":"Denk nach!"}]}

- "answers" hat GENAU drei Einträge.
- "correctIndex" ist 0, 1 oder 2 und zeigt auf die richtige Antwort.
- "thinkSeconds": 5 für easy und medium, 6 für hard, 7 für impossible.
- "flag" weglassen, wenn die Frage keine Flagge zeigt.`;

export function buildQuizPrompt(args: {
  topic: string;
  count: number;
  /** Which flag codes exist locally, when the topic calls for flags. */
  availableFlags?: string[];
}): string {
  const flags = args.availableFlags?.length
    ? `\n\nVerfügbare Flaggen-Codes (nur diese verwenden):\n${args.availableFlags.join(" ")}`
    : "";

  return `Thema: ${args.topic}

Schreib ${args.count} Fragen dazu.

Ungefähr gleich viele Fragen je Schwierigkeit, aber GEMISCHT über das ganze
Video verteilt — nicht nach Schwierigkeit sortiert. Zwei gleich schwere Fragen
sollen möglichst nicht direkt hintereinander stehen.

Vergib die ids fortlaufend: q1, q2, q3 …${flags}`;
}

/**
 * The opening and closing lines.
 *
 * Separate from the questions because they are the only part with a job other
 * than being correct: the first five seconds decide whether anyone sees
 * question three.
 */
export const QUIZ_FRAME_SYSTEM_PROMPT = `Du schreibst Titel, Einstieg und Schluss für ein Quiz-Video auf Deutsch.

- "title": maximal 40 Zeichen, eine Herausforderung. "Errätst du diese Flaggen?"
- "intro": ein bis zwei Sätze, die sofort zur ersten Frage führen. Nennt die
  Anzahl der Fragen und die Bedenkzeit. Keine Begrüßung, keine Vorrede.
- "outro": ein Satz, der zum Kommentieren auffordert.
- Du-Form, niemals Sie-Form.

Antworte mit einem JSON-Objekt, sonst nichts:
{"title":"…","intro":"…","outro":"…"}`;
