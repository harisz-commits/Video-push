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

/**
 * The outline, and the motifs that will hold the film together.
 *
 * A separate call because of a hard, measured limit: asked for 4,000 words in
 * one reply, Gemini 3.7 Flash returned 1,160 — twenty-nine percent, and not
 * because it ran out of room (10,603 of 32,000 output tokens). It simply
 * stops. No phrasing fixes that; the script has to be written in pieces, and
 * pieces need a plan they can be written against.
 *
 * The recurring motifs are decided here too, and that is what makes writing
 * the sections in parallel possible without the film falling apart: every
 * section draws on the same small set of shared pictures, so the motifs come
 * back across the whole video even though no section knows what the others
 * wrote.
 */
export const STORY_OUTLINE_SYSTEM_PROMPT = `Du planst ein deutsches Erklärvideo, bevor es geschrieben wird.

DER BOGEN:
- Teile das Thema in Abschnitte, die aufeinander aufbauen.
- Der erste Abschnitt wirft eine Frage auf, die Mitte beantwortet sie in
  Schritten, der letzte dreht sie noch einmal.
- Jeder Abschnitt behandelt EINEN Gedanken. Kein Abschnitt wiederholt einen
  anderen — sie werden getrennt voneinander geschrieben, und was du hier nicht
  auseinanderhältst, steht später doppelt im Video.
- "brief" sagt in ein bis zwei Sätzen, was in diesem Abschnitt gesagt wird.
  Sei konkret: nenn die Sache beim Namen, nicht das Thema noch einmal.

DIE WIEDERKEHRENDEN MOTIVE:
- Fünf bis acht Bilder, die im ganzen Video immer wieder auftauchen dürfen.
- Sie sind das visuelle Rückgrat: das Lagerfeuer, die Landschaft, das Werkzeug
  — Dinge, die in vielen Abschnitten passen, nicht nur in einem.
- "prompt" beschreibt NUR den Inhalt, auf Englisch. Kein Wort über Stil oder
  Farben; das kommt aus dem Stil-Text.
- "key" ist ein Kleinbuchstaben-Slug: a-z, 0-9, Bindestriche, Umlaute
  ausgeschrieben.

DIE KLANGTEPPICHE:
- Drei bis fünf Hintergrundgeräusche, die unter den Abschnitten laufen.
- Sie tragen die Spannung, die dieses Format sonst nicht hat: es bewegt sich
  kein Bild wirklich, also muss der Ton die Arbeit machen. Wind über Schnee,
  ein knisterndes Feuer, tropfendes Wasser in einer Höhle, das Rauschen eines
  Flusses.
- Beschreib in "prompt" auf Englisch, was zu hören ist. Keine Musik, keine
  Melodie, keine Stimmen — das würde gegen den Sprecher arbeiten.
- Jeder Teppich passt zu MEHREREN Abschnitten. Drei gute sind besser als acht,
  die sich kaum unterscheiden.

Antworte mit einem JSON-Objekt, sonst nichts:
{"sections":[{"title":"…","brief":"…"}],
 "motifs":[{"key":"…","name":"…","prompt":"…"}],
 "beds":[{"key":"…","name":"…","prompt":"…"}]}`;

export function buildOutlinePrompt(args: {
  topic: string;
  style: StoryStyle;
  minutes: number;
  sections: number;
  motifs: number;
  beds: number;
}): string {
  return `Thema des Videos:
${args.topic}

Bildstil steht fest: „${args.style.name}"

Plane genau ${args.sections} Abschnitte für ${args.minutes} Minuten Video,
${args.motifs} wiederkehrende Motive und ${args.beds} Klangteppiche.

Der Inhalt muss tragen. Ein Abschnitt, der nur sagt "es war kalt und schwer",
ist verschenkt. Jeder Abschnitt braucht etwas Konkretes: eine Technik, eine
Zahl, einen Gegenstand, eine Entscheidung, eine Folge. Wenn du zum Thema
nichts Konkretes weißt, wähl einen anderen Abschnitt.`;
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
- Im DURCHSCHNITT acht Wörter je Einstellung. Nicht jede.
- Die einzelnen dürfen zwischen 3 und 14 Wörtern liegen, und sie sollen es
  auch: aus der Satzlänge entsteht die Standzeit des Bildes, also ist sie dein
  einziges Mittel für Tempo. Drei Wörter sind ein harter Schnitt, vierzehn
  lassen ein Bild stehen.
- Gemessen an einem früheren Lauf: alle Sätze lagen zwischen sieben und neun
  Wörtern. Das ist gleichmäßig, sicher und tot. Streu bewusst.
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

TEMPO — das ist die wichtigste Regel dieses Abschnitts:
- Die Standzeit eines Bildes IST die Länge deines Satzes. Es gibt kein anderes
  Mittel, das Tempo zu steuern.
- Ein Satz mit drei bis fünf Wörtern ist ein harter, schneller Schnitt. Drei
  davon hintereinander treiben an. Ein Satz mit zwölf bis vierzehn Wörtern
  lässt das Bild stehen und beruhigt.
- Bau den Wechsel absichtlich: vor einer wichtigen Aussage eine kurze, harte
  Einstellung; nach einer Reihe kurzer ein langer Satz, der sie auffängt.
- Prüf deinen Abschnitt am Ende selbst: liegen alle Sätze in einer engen
  Spanne, hast du kein Tempo gebaut, sondern es vermieden. Schreib ihn um.

BEWEGUNG:
- "motion" bewegt das Standbild langsam: "in" (heran), "out" (weg),
  "left", "right", "up", "down".
- Wähl sie nach dem Inhalt, nicht nach Abwechslung allein: "in" bei einem
  Detail, auf das es ankommt; "out" wenn sich etwas als größer herausstellt
  als gedacht; "left"/"right" bei Landschaften und Wegen; "up" bei Höhe,
  "down" bei Schnitten in den Boden oder in die Tiefe.
- Zwei gleiche Bewegungen hintereinander wirken wie ein Fehler, und dasselbe
  Bild mit anderer Bewegung wirkt wie eine neue Einstellung.

KLANG:
- "ambience" nennt den Klangteppich, der unter dieser Einstellung läuft — mit
  dem "key" aus der Liste, die du bekommst. Setz denselben Teppich über viele
  Einstellungen am Stück; ein Wechsel bei jeder Einstellung wäre Lärm.
  Ein Wechsel markiert einen Ortswechsel oder einen Gedankensprung.
- "accent" ist ein einzelnes Geräusch genau auf dieser Einstellung: ein
  brechender Knochen, ein Schlag Stein auf Stein, eine Böe, die ankommt.
  SPARSAM — höchstens jede fünfte bis achte Einstellung. Ein Akzent auf jeder
  wäre kein Sounddesign, sondern ein Schlagzeug.
- Setz Akzente dorthin, wo der Satz sie selbst nennt. Wenn der Text von
  splitterndem Eis spricht, gehört das Geräusch genau dahin — nicht zwei
  Einstellungen später.

Antworte mit einem JSON-Objekt, sonst nichts:
{"images":[{"key":"…","name":"…","prompt":"…"}],
 "accents":[{"key":"…","name":"…","prompt":"…","seconds":2}],
 "shots":[{"text":"…","image":"…","motion":"in","ambience":"…","accent":"…"}]}

- Jeder "image"-Wert in shots MUSS als "key" in images vorkommen.
- Jedes Bild in images MUSS von mindestens einer Einstellung benutzt werden.
- "ambience" nimmt nur "key"-Werte aus den vorgegebenen Klangteppichen.
- "accent" ist optional und verweist auf einen "key" aus deiner
  accents-Liste. "prompt" dort auf Englisch, "seconds" zwischen 1 und 4.`;

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
 * One section of the film.
 *
 * Given the whole outline, not just its own line, so it knows what came before
 * and what follows and does not re-explain either. The sections are written
 * independently and in parallel; the outline is the only thing keeping them
 * from colliding.
 */
export function buildSectionPrompt(args: {
  topic: string;
  style: StoryStyle;
  sections: { title: string; brief: string }[];
  index: number;
  words: number;
  /** Motif keys every section may reuse, chosen once for the whole film. */
  motifs: { key: string; name: string }[];
  /** Bed keys, likewise chosen once, so the sound does not change per section. */
  beds: { key: string; name: string }[];
  /** How many NEW pictures this section may invent on top of the motifs. */
  imageBudget: number;
}): string {
  const plan = args.sections
    .map((s, i) => `${i + 1}. ${s.title} — ${s.brief}${i === args.index ? "   <<< DIESEN schreibst du" : ""}`)
    .join("\n");

  const shots = Math.max(2, Math.round(args.words / 8));

  return `Thema des Videos:
${args.topic}

Bildstil steht fest: „${args.style.name}". Beschreib in "prompt" nur den Inhalt.

DER PLAN DES GANZEN VIDEOS:
${plan}

Schreib NUR Abschnitt ${args.index + 1}. Nicht die anderen, nicht ihre Inhalte,
und keine Zusammenfassung des Ganzen. ${
    args.index === 0
      ? "Es ist der Anfang: der erste Satz muss neugierig machen, ohne Begrüßung."
      : args.index === args.sections.length - 1
        ? "Es ist der Schluss: der letzte Satz ist ein Gedanke, der bleibt."
        : "Es ist ein Abschnitt aus der Mitte: steig ohne Einleitung ein und hör ohne Fazit auf, der nächste Abschnitt macht weiter."
  }

LÄNGE: ungefähr ${args.words} Wörter, das sind etwa ${shots} Einstellungen.
Halte diese Länge ein — sie ist auf das ganze Video abgestimmt.

DIESE BILDER GIBT ES SCHON und du sollst sie benutzen, wo sie passen:
${args.motifs.map((m) => `- ${m.key} (${m.name})`).join("\n") || "- keine"}
Nimm ihre "key"-Werte direkt in den Einstellungen. Führ sie NICHT noch einmal
in "images" auf.

NEUE BILDER: höchstens ${args.imageBudget}. Jedes kostet Geld — lass lieber ein
Motiv wiederkehren.

DIESE KLANGTEPPICHE STEHEN ZUR VERFÜGUNG. Setz einen davon auf jede
Einstellung, meist über viele Einstellungen denselben:
${args.beds.map((b) => `- ${b.key} (${b.name})`).join("\n") || "- keine"}`;
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
