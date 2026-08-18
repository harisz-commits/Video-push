import type { StoryStyle } from "./story";

/**
 * What the model is told when it writes a video.
 *
 * Two calls, not one, and the order matters: the look is decided first and
 * then handed to the writer, so every picture is described by somebody who
 * already knows what the film looks like. Written the other way round, the
 * style would be a summary of a hundred independent descriptions — which is
 * how a video ends up looking like a hundred videos.
 */

/** Words a minute. See StoryProject.speed for why this is above conversational. */
export const WORDS_PER_MINUTE = 160;

export const STORY_STYLE_SYSTEM_PROMPT = `Du legst den Bildstil für ein deutsches Erklärvideo fest.

Alle Bilder des Videos werden einzeln erzeugt, jedes ohne Kenntnis der
anderen. Das Einzige, was sie zusammenhalten wird, ist der Text, den du hier
schreibst — er wird jedem einzelnen Bildauftrag wörtlich angehängt. Schreib ihn
so, dass zwei Bilder mit völlig verschiedenem Inhalt trotzdem erkennbar von
derselben Hand stammen.

DER STIL-TEXT ("directive") MUSS FESTLEGEN:
- Technik: durchgehend Illustration. Niemals Fotografie, niemals Fotorealismus,
  kein 3D-Render.
- Die Farbpalette in Worten UND als Hexwerte, mit einer klaren Grundstimmung,
  die zum Thema passt (Wüstenthema: Sand, Ocker, gebranntes Rot, Schatten in
  Indigo — kein Neon).
- Linienführung und Flächen: Strichstärke, ob Konturen sichtbar sind, ob
  Flächen flach oder körnig sind.
- Eine durchgehende Textur, z. B. feines Korn wie bei altem Siebdruck.
- Perspektive und Bildaufbau: meist seitlich oder leicht erhöht, ruhige
  Horizonte, viel Luft um das Motiv.
- Menschen: fast nie realistisch. Wenn Figuren vorkommen, dann als moderne,
  reduzierte Strichfiguren mit klarer Silhouette und ohne Gesichtszüge.
  Der Schwerpunkt liegt auf Gebäuden, Gegenständen, Werkzeugen, Landschaften,
  Schnittbildern und Diagrammen.
- Kein Text im Bild. Keine Schrift, keine Zahlen, keine Beschriftungen,
  keine Wasserzeichen.

Der Stil-Text ist eine Anweisung an einen Zeichner, kein Werbetext. Schreib ihn
auf Englisch — die Bildmodelle folgen englischen Anweisungen zuverlässiger.
400 bis 900 Zeichen.

Antworte mit einem JSON-Objekt, sonst nichts:
{"title":"…","styleName":"…","directive":"…","palette":["#rrggbb","#rrggbb","#rrggbb"]}

- "title": maximal 60 Zeichen, deutsch, macht neugierig.
- "styleName": kurzer deutscher Name des Looks, z. B. "Sand und Indigo,
  Siebdruck". Er wird zum Schlüssel, unter dem Bilder dieses Looks später
  wiedergefunden werden — also beschreibend, nicht poetisch.
- "palette": 3 bis 5 Hexwerte, dieselben, die im directive genannt sind.`;

export function buildStylePrompt(topic: string): string {
  return `Thema des Videos:
${topic}

Leg den Bildstil fest, der zu diesem Thema passt.`;
}

export const STORY_SCRIPT_SYSTEM_PROMPT = `Du schreibst ein deutsches Erklärvideo: gesprochenen Text und dazu die Bilder.

DER GESPROCHENE TEXT:
- Durchgehende Erzählung, kein Stichpunktzettel. Sie wird am Stück vorgelesen.
- Du-Form, niemals Sie-Form. Kurze Hauptsätze.
- Der erste Satz muss neugierig machen, ohne etwas zu versprechen, das später
  nicht kommt. Keine Begrüßung, kein "In diesem Video".
- Sachlich richtig. Erfinde keine Zahlen, keine Jahreszahlen, keine Rekorde.
  Was du nicht sicher weißt, lässt du weg — es steht danach jahrelang online.
- Kein Fazit-Geschwafel am Ende. Der letzte Satz ist ein Gedanke, der bleibt.

DIE AUFTEILUNG IN EINSTELLUNGEN ("shots"):
- Jede Einstellung ist EIN Bild und der Text, der dazu gesprochen wird.
- Zwei bis vier Sekunden pro Einstellung. Bei diesem Tempo sind das
  5 bis 11 Wörter. Halte dich daran — längere Texte stehen zu lange auf
  demselben Bild.
- Schneide an Sinngrenzen, nicht mitten im Gedanken.
- Aneinandergehängt ergeben alle Einstellungstexte den fertigen Fließtext.
  Schreib ihn so, dass er sich als Ganzes flüssig liest.

DIE BILDER:
- Ein Bild kann MEHRFACH benutzt werden. Nutze das: ungefähr eine Einstellung
  von dreien greift auf ein Bild zurück, das es schon gibt. Das ist keine
  Notlösung, sondern gibt dem Video wiederkehrende Motive — und jedes neue
  Bild kostet Geld.
- "prompt" beschreibt NUR den Inhalt: was zu sehen ist, aus welchem Blickwinkel.
  Auf Englisch. Kein Wort über Stil, Farben oder Technik — das kommt aus dem
  Stil-Text und würde sich sonst widersprechen.
- Keine Schrift im Bild. Beschreibe niemals Text, Zahlen oder Beschriftungen.
- Menschen sparsam und nur als reduzierte Strichfiguren. Zeig lieber die Sache
  selbst: Gebäude, Werkzeuge, Landschaften, Gegenstände, Schnittbilder.
- "name" ist ein kurzer deutscher Name des Bildes, an dem man es in einer Liste
  wiedererkennt: "Lehmziegelhaus von der Seite", "Wasserkrug im Schatten".
- "key" ist derselbe Name als Kleinbuchstaben-Slug: nur a-z, 0-9 und
  Bindestriche, Umlaute ausgeschrieben. "lehmziegelhaus-von-der-seite".

BEWEGUNG:
- "motion" bewegt das Standbild langsam: "in" (heran), "out" (weg),
  "left", "right", "up", "down".
- Wechsle sie ab. Zwei gleiche Bewegungen hintereinander wirken wie ein Fehler,
  und dasselbe Bild mit anderer Bewegung wirkt wie eine neue Einstellung.

Antworte mit einem JSON-Objekt, sonst nichts:
{"images":[{"key":"…","name":"…","prompt":"…"}],
 "shots":[{"text":"…","image":"…","motion":"in"}]}

- Jeder "image"-Wert in shots MUSS als "key" in images vorkommen.
- Jedes Bild in images MUSS von mindestens einer Einstellung benutzt werden.`;

export function buildScriptPrompt(args: {
  topic: string;
  style: StoryStyle;
  minutes: number;
  /** Roughly how many distinct pictures to draw. See the budget note below. */
  imageBudget: number;
}): string {
  const words = Math.round(args.minutes * WORDS_PER_MINUTE);
  const shots = Math.round((args.minutes * 60) / 3);

  return `Thema des Videos:
${args.topic}

Der Bildstil steht schon fest und wird jedem Bildauftrag angehängt. Beschreib
in "prompt" deshalb nur den Inhalt, nie den Stil:
„${args.style.name}"

LÄNGE:
- Ungefähr ${words} Wörter gesprochener Text, das sind etwa ${args.minutes} Minuten.
- Ungefähr ${shots} Einstellungen.
- Höchstens ${args.imageBudget} verschiedene Bilder. Das ist eine harte Grenze:
  jedes Bild kostet, und ${shots} Einstellungen aus ${args.imageBudget} Bildern
  zu bauen ist genau die Aufgabe. Lass Motive wiederkehren.

Vergib die Reihenfolge so, dass das Video einen Bogen hat: der Einstieg wirft
eine Frage auf, die Mitte beantwortet sie in Schritten, der Schluss dreht sie
noch einmal.`;
}

/**
 * The text actually sent to the image model.
 *
 * The medium is stated three times — before the subject, inside the style
 * block, and after it — which looks redundant and is not. Measured on a
 * fourteen-picture film, one came back as a photograph: a bowl of kohl and a
 * glass flacon, drawn beautifully and completely wrong, because "kohl and a
 * flacon" is a product still life and the training data for that phrase is
 * photographs almost to the exclusion of anything else. A subject with a
 * strong photographic prior will override a style instruction that is
 * mentioned once and placed after it.
 *
 * So the medium comes first, where the model weights it most, and the refusal
 * is spelled out as the specific things it must not be rather than as the
 * abstraction "no photorealism" — which a photograph does not recognise itself
 * as.
 */
export function imagePrompt(subject: string, style: StoryStyle): string {
  return `A flat 2D illustration — a drawing, not a photograph.

SUBJECT: ${subject.trim()}

STYLE (follow exactly; this is the house style for every image in this film):
${style.directive.trim()}

HARD CONSTRAINTS:
- This is an illustration. It is NOT a photograph, NOT a photo studio shot,
  NOT product photography, NOT a 3D render, NOT CGI. No camera depth of field,
  no lens blur, no realistic skin, no photographic lighting.
- No text, no letters, no numbers, no captions, no watermarks, no signatures.
- Single coherent illustration, full bleed, 16:9.`;
}
