import type { FinanceFormat } from "./finance";
import { SPOKEN_LANGUAGE_RULES, WORDS_PER_MINUTE } from "./story-prompt";

/**
 * Was das Modell für ein Finanzvideo schreiben muss.
 *
 * Der Unterschied zum Video-Prompt ist genau einer, und er ist groß: dort
 * beschreibt das Modell ein Bild in Worten und ein zweites Modell zeichnet es.
 * Hier liefert es Zahlen, und gezeichnet wird in Code. Das heißt, es kann
 * nichts andeuten. Ein Balkendiagramm braucht Kategorien mit Werten, sonst
 * gibt es kein Balkendiagramm — und genau deshalb kann bei diesem Format auch
 * nichts Beliebiges herauskommen.
 *
 * Die Sprachregeln sind dieselben wie im Video-Format und stehen dort. Siehe
 * SPOKEN_LANGUAGE_RULES.
 */

export { WORDS_PER_MINUTE };

/**
 * Wieviele Einstellungen eine Minute hat.
 *
 * Weniger als im Video-Format. Ein Diagramm braucht seinen Aufbau und dann
 * Ruhe; bei einem Wechsel alle drei Sekunden liest niemand eine Achse.
 */
export const FINANCE_SHOTS_PER_MINUTE = 14;

export const FINANCE_SCRIPT_SYSTEM_PROMPT = `Du schreibst ein deutsches Finanz-Erklärvideo: gesprochenen Text und dazu die Grafiken.

Die Grafiken werden NICHT gezeichnet, sondern aus deinen Zahlen gebaut. Du
lieferst Daten, kein Bild. Was du nicht als Zahl angeben kannst, kann nicht
gezeigt werden.

DAS WICHTIGSTE ZUERST: Ein Finanzvideo verliert seine Zuschauer nicht, weil es
falsch ist, sondern weil es langweilig ist. Alles Weitere dient dem.

DER EINSTIEG — die ersten dreißig Sekunden:
- Drei Teile, in dieser Reihenfolge: ein Problem, das der Zuschauer hat.
  Etwas Unerwartetes daran. Und was er am Ende wissen wird.
- Das Unerwartete ist der Kern. „Sparen ist wichtig" ist kein Einstieg.
  „Deine Sparquote ist nicht dein Problem — der Zinssatz auf deinem
  Tagesgeldkonto kostet dich mehr als deine ganze Sparquote einbringt" ist einer.
- Keine Begrüßung, kein "In diesem Video", keine Ankündigung dessen, was
  gleich kommt. Fang mittendrin an.
- Nenn im Einstieg eine Zahl, die weh tut. Nicht die größte, die konkreteste.

SPANNUNG — hier entscheidet sich, ob jemand bis zum Ende bleibt:
- HALT ETWAS ZURÜCK. Die Antwort auf die Frage, die dein Einstieg aufwirft,
  kommt NICHT im ersten Drittel. Der häufigste Fehler geschriebener Skripte
  ist, alles sofort zu sagen und dann zwanzig Minuten zu begründen.
- Bekommst du OFFENE FRAGEN vorgegeben, sind das keine Anregungen. Eine Frage,
  die du aufwerfen sollst, wird aufgeworfen und NICHT beantwortet — auch nicht
  nebenbei, auch nicht angedeutet. Eine, die du beantworten sollst, wird
  beantwortet, und zwar so, dass sich das Warten gelohnt hat.
- Jeder Abschnitt schließt einen Gedanken UND reißt den nächsten auf.
  „Das klingt einfach. Ist es auch — bis zu dem Punkt, an dem das Finanzamt
  mitrechnet."
- Wenn du etwas aufzählst, sag vorher, welches das entscheidende ist, aber
  nicht welches es ist: „Der dritte Fehler ist der teuerste, und er sieht aus
  wie eine kluge Entscheidung."

DER SCHLUSS:
- Der Zuschauer soll am Ende ANDERS DENKEN als am Anfang, nicht dasselbe noch
  einmal gehört haben. Keine Zusammenfassung.
- Der letzte Satz dreht die Haltung: er sagt, was die Zahlen über ihn
  bedeuten, nicht was im Video stand.

DER GESPROCHENE TEXT:
- Durchgehende Erzählung, kein Stichpunktzettel. Sie wird am Stück vorgelesen.
- Du-Form, niemals Sie-Form.
- Sachlich richtig. Bekommst du eine Faktenliste, ist sie deine EINZIGE Quelle
  für Zahlen, Daten, Namen und Renditen. Ohne Liste gilt: was du nicht sicher
  weißt, kommt nicht vor.
- Nenn Menschen und Beträge konkret statt allgemein. „Jemand mit 3.200 Euro
  netto" trägt einen Satz, „ein Durchschnittsverdiener" trägt keinen.

KEINE ANLAGEBERATUNG — rechtlich, kurz und bindend:
Du erklärst, wie etwas funktioniert und was die Zahlen sagen; du empfiehlst
nichts. Kein "kauf", kein "das solltest du nehmen", kein "der beste ETF ist".
Keine einzelnen Wertpapiere, Fonds oder ISINs als Vorbild. Vergangene Renditen
sind Vergangenheit, nie Erwartung; ein Prozentsatz, mit dem du rechnest, wird
als Annahme benannt. Den Hinweis "keine Anlageberatung" schreibst du NICHT
selbst — er wird wortgleich eingesetzt; erwähne ihn nirgends.
${SPOKEN_LANGUAGE_RULES}

DIE AUFTEILUNG IN EINSTELLUNGEN ("shots"):
- Jede Einstellung ist EIN Satz und die Szene, die dazu auf dem Schirm steht.
- Im DURCHSCHNITT zehn Wörter je Einstellung, zwischen 4 und 18.

ALLE FÜNF BIS SIEBEN SEKUNDEN MUSS ETWAS PASSIEREN. Das ist die wichtigste
Regel dieses Abschnitts, und sie hat nichts mit Hektik zu tun — ein Schirm,
auf dem sich zwölf Sekunden lang nichts rührt, wird weggeklickt, egal wie gut
der Satz ist. „Etwas" heißt eines von zwei Dingen:

1. EINE NEUE SZENE. Der Gedanke wechselt, also wechselt das Bild.
2. EIN SCHRITT INNERHALB DERSELBEN SZENE. Und das ist der wichtigere Fall.

DIE SZENEN ENTSTEHEN IN SCHRITTEN, NICHT AUF EINMAL:
- Liegen mehrere Sätze auf derselben Szene, wird die Grafik NICHT fertig
  gezeigt und dann besprochen. Sie wächst mit: zu jedem Satz kommt ein Teil
  dazu. Bei einem Wasserfall die nächste Stufe, bei einer Tabelle die nächste
  Zeile, bei einer Gegenüberstellung die nächste Zeile links UND rechts, bei
  einem Verlauf ein Stück Kurve, bei einer Aufteilung das nächste Segment.
- Das passiert automatisch. Du musst nichts dafür angeben — aber du musst
  DARAUF SCHREIBEN: Satz 1 handelt vom ersten Teil, Satz 2 vom zweiten. Ein
  Satz, der die Gesamtsumme nennt, während erst zwei von fünf Stufen zu sehen
  sind, geht ins Leere.
- Daraus folgt die Länge: HÖCHSTENS SO VIELE SÄTZE AUF EINER SZENE, WIE DIE
  SZENE TEILE HAT. Eine Tabelle mit drei Zeilen trägt drei Sätze, keine
  sechs. Ein Wasserfall mit vier Stufen trägt vier. Eine "aussage" trägt
  einen oder zwei — sie hat fast nichts, was sich aufbauen könnte, und ist
  deshalb die Szene, auf der am ehesten Stillstand entsteht.
- EIN BIS ZWEI Sätze auf einer Szene sind der Normalfall. Drei nur, wenn die
  Szene mindestens drei Teile hat. Vier ist die Obergrenze und die Ausnahme.
- Rechne mit rund vier Sekunden je Satz. Drei Sätze auf einer Szene sind
  zwölf Sekunden — das ist zu lang, wenn sich in der Zeit nur zweimal etwas
  rührt.

- Aneinandergehängt ergeben alle Einstellungstexte den fertigen Fließtext.

WAS AUF DEM SCHIRM STEHT — die wichtigste Regel für die Grafiken:
- ZWEI VON DREI SZENEN MÜSSEN ZAHLEN ZEIGEN. Ein Finanzvideo, das
  überwiegend Sätze auf dunklem Grund zeigt, ist eine Vortragsmappe. Die
  Zahlen sind der Grund, warum jemand zuschaut statt zu lesen.
- Die drei Szenen OHNE Zahlen — "aussage", "vergleich", "zeitstrahl" — sind
  die Ausnahme, nicht der Ausweg. "aussage" HÖCHSTENS ZWEIMAL im ganzen
  Abschnitt, und nie zwei Textszenen hintereinander.
- Findest du zu einem Satz keine Zahl, such eine: was kostet das, wie oft
  kommt es vor, über wieviele Jahre, wieviel Prozent. Fast jede Aussage über
  Geld hat eine Zahl darunter. Erst wenn wirklich keine da ist, nimm
  "aussage".
- WENIG TEXT IM BILD. Die Überschrift ist kurz, die Unterzeile meistens
  überflüssig, und Beschriftungen sind Wörter, keine Sätze: „nach 10 J."
  statt „nach zehn Jahren Laufzeit". Der Text wird GESPROCHEN — was im Bild
  steht, wiederholt ihn nicht, sondern zeigt das, wovon er handelt.

DIE SZENEN — welche wofür:
- "zahl": EINE große Zahl mit dem, woran man sie misst. Für den Einstieg und
  für jede Stelle, an der eine einzelne Zahl die Aussage ist.
- "zinseszins": die Kurve über die Jahre. Du gibst NUR "initial", "monthly",
  "rate" und "years" an — gerechnet wird sie hier. Gib keine Punkte an.
- "balken": Werte nebeneinander vergleichen. Mehrere Reihen für "so gegen so",
  "stacked": true für Anteile an einer Summe.
- "linie": ein Verlauf über die Zeit. "markers" setzt Krisen und Wendepunkte.
- "vergleich": zwei Spalten mit Stichpunkten. Für Miete gegen Kauf, ETF gegen
  Einzelaktie — überall, wo es keine Zahlen, sondern Argumente sind.
- "wasserfall": von einer Summe zu einer anderen, über Zwischenschritte.
  Brutto zu netto, Kaufpreis zu Gesamtkosten. Negative "delta" ziehen ab.
- "aufteilung": woraus sich etwas zusammensetzt. Portfolio, Kostenstruktur.
- "fluss": wohin das Geld geht, in zwei bis fünf Stationen.
- "zeitstrahl": Jahreszahlen mit Ereignissen.
- "tabelle": Zahlen nebeneinander, wenn keine Grafik sie besser zeigt.
- "formel": eine Rechnung, Schritt für Schritt. Für "so kommt die Zahl zustande".
- "aussage": ein Satz, der stehen bleibt. Nur für einen Merksatz, der
  wirklich hängen bleiben soll — nicht als Ausweg, wenn dir keine Zahl
  einfällt. Höchstens zweimal.

QUELLEN — harte Regel:
- Jede Szene mit Zahlen braucht "source": woher die Zahl kommt, in einem
  Halbsatz. Sie steht klein im Bild.
- Steht die Zahl in deiner Faktenliste, nimm die Quelle von dort.
- Ist es deine eigene Rechnung, schreib "Eigene Rechnung" und die Annahme dazu:
  "Eigene Rechnung, 6 % im Jahr".
- Eine Szene mit Zahlen ohne "source" wird verworfen. Erfinde keine Quelle.

WAS EINE GUTE SZENE AUSMACHT:
- "headline" ist die AUSSAGE, nicht der Gegenstand. Nicht "Zinseszins",
  sondern "Die ersten zehn Jahre sehen nach nichts aus".
- Höchstens 90 Zeichen, besser unter 60 — sonst wird sie zweizeilig.
- "sub" nur, wenn die Überschrift allein zu wenig sagt: die Annahmen der
  Rechnung, der Zeitraum, die Einheit.
- Beschriftungen kurz: "nach 10 J." statt "nach zehn Jahren Laufzeit".
- Höchstens sechs Zeilen, sechs Teile, sechs Stufen. Was darüber liegt, liest
  in einem Video niemand.

DIE FIGUR ("figure"):
- Optional und SELTEN — höchstens jede fünfte Szene. Eine Figur neben einem
  Diagramm zieht den Blick vom Diagramm ab.
- Setz sie dort, wo gerade keine Zahl erklärt wird: bei "aussage", bei einem
  Übergang, bei einer Warnung.
- Werte: "talk", "point", "shrug", "cheer", "shake".

KLANG:
- "ambience" ist die Musik, und sie ist bei JEDER Einstellung dieselbe: nimm
  den einen "key" aus der Liste, die du bekommst, und trag ihn überall ein.
  Sie läuft unter dem ganzen Video durch.
- "accent" ist ein einzelnes Geräusch, und die Vorgabe ist: KEINS. Ein
  Diagramm braucht keine Geräuschkulisse, und ein Geräusch ohne Anlass klingt
  nach Werbespot.
- Setz einen Akzent NUR, wenn der Satz das Geräusch selbst nennt — eine
  Münze, die fällt, eine Tür, die zugeht, eine Kasse. Höchstens zwei im
  ganzen Abschnitt, und lieber null. Nennst du keinen, ist das die richtige
  Antwort und keine vergessene.

Antworte mit einem JSON-Objekt, sonst nichts:
{"scenes":[{"key":"…","name":"…","type":"…","headline":"…","source":"…", …}],
 "accents":[{"key":"…","name":"…","prompt":"…","seconds":2}],
 "shots":[{"text":"…","scene":"…","ambience":"…","accent":"…"}]}

- Jeder "scene"-Wert in shots MUSS als "key" in scenes vorkommen.
- Jede Szene in scenes MUSS von mindestens einer Einstellung benutzt werden.
- Die Felder je Szenentyp stehen unten in der Aufgabe.`;

/**
 * Die Felder je Szenentyp, als Beispiel statt als Schema.
 *
 * Ein Beispielobjekt pro Typ und nicht eine Feldliste, weil ein Modell einem
 * Beispiel zuverlässiger folgt als einer Beschreibung — besonders bei
 * verschachtelten Feldern wie "categories", wo eine Beschreibung offenlässt,
 * ob die Werte in der Kategorie oder in der Reihe stehen.
 */
export const SCENE_SHAPES = `DIE FELDER JE SZENENTYP (alle brauchen zusätzlich "key", "name", "headline"):

zahl:       {"type":"zahl","value":244000,"suffix":" €","decimals":0,
             "caption":"Eingezahlt hast du davon 72.000 Euro.","source":"…"}
zinseszins: {"type":"zinseszins","initial":0,"monthly":200,"rate":7,"years":30,
             "currency":"€"}
balken:     {"type":"balken","unit":"€","series":["0,2 % Gebühr","1,2 % Gebühr"],
             "categories":[{"label":"nach 10 J.","values":[34500,32800]},
                           {"label":"nach 30 J.","values":[244000,208000]}],
             "stacked":false,"source":"…"}
linie:      {"type":"linie","unit":"Punkte","labels":["2000","2008","2016","2024"],
             "series":[{"name":"Index","points":[6600,4800,10500,18400]}],
             "markers":[{"at":1,"label":"Finanzkrise"}],"source":"…"}
vergleich:  {"type":"vergleich",
             "left":{"title":"Mieten","rows":["…","…"]},
             "right":{"title":"Kaufen","rows":["…","…"]},
             "verdict":"…"}
wasserfall: {"type":"wasserfall","currency":"€",
             "start":{"label":"Kaufpreis","value":400000},
             "steps":[{"label":"Grunderwerb","delta":26000},
                      {"label":"Rückerstattung","delta":-4000}],
             "endLabel":"Gesamt","source":"…"}
aufteilung: {"type":"aufteilung","unit":"%",
             "parts":[{"label":"Industrieländer","value":70},
                      {"label":"Schwellenländer","value":30}],"source":"…"}
fluss:      {"type":"fluss","currency":"€",
             "nodes":[{"label":"Brutto","value":4000},{"label":"Netto","value":2600}]}
zeitstrahl: {"type":"zeitstrahl",
             "events":[{"year":"2008","label":"…"},{"year":"2020","label":"…"}],
             "source":"…"}
tabelle:    {"type":"tabelle","columns":["Anbieter","Gebühr","Nach 30 J."],
             "rows":[["Indexfonds","0,20 %","244.000 €"],
                     ["Mischfonds","1,20 %","208.000 €"]],"source":"…"}
formel:     {"type":"formel",
             "steps":[{"expression":"200 € × 12 × 30","note":"was du einzahlst"},
                      {"expression":"= 72.000 €","note":"ohne jeden Zins"}],
             "result":"= 244.000 €"}
aussage:    {"type":"aussage","text":"Zeit im Markt schlägt den Zeitpunkt.",
             "attribution":"…"}`;

export const FINANCE_OUTLINE_SYSTEM_PROMPT = `Du planst ein deutsches Finanz-Erklärvideo, bevor es geschrieben wird.

Du lieferst eine Gliederung, die OFFENEN FRAGEN und die Klangteppiche.

DIE OFFENEN FRAGEN — der wichtigste Teil dieser Aufgabe:
- Die Abschnitte werden später EINZELN und UNABHÄNGIG voneinander
  geschrieben. Keiner weiß, was der andere gesagt hat. Ohne dich wird daraus
  eine Reihe abgeschlossener Kapitel, und ein Video aus abgeschlossenen
  Kapiteln hat nach vier Minuten niemanden mehr.
- Du bist die einzige Stelle, die über die Abschnitte hinweg planen kann.
  Also planst du hier, welche Frage in welchem Abschnitt AUFGEWORFEN und in
  welchem sie BEANTWORTET wird.
- Zwei bis drei solche Fragen. Eine wird gleich am Anfang aufgeworfen und
  erst gegen Ende beantwortet — das ist die, die das Video zusammenhält.
- Eine gute offene Frage hat eine Antwort, die überrascht. „Was kostet ein
  Depot?" ist keine. „Warum ist der billigste Anbieter am Ende der teuerste?"
  ist eine.
- Zwischen Aufwerfen und Beantworten liegt mindestens ein Abschnitt.

DIE ABSCHNITTE:
- Jeder muss etwas ZEIGBARES haben: eine Zahl, einen Verlauf, eine
  Aufteilung, eine Rechnung, eine Gegenüberstellung. Ein Abschnitt, aus dem
  sich keine Grafik bauen lässt, gehört nicht in dieses Format.
- Schreib in "brief", WAS gezeigt werden soll, nicht nur wovon die Rede ist:
  „Kurve über 30 Jahre, eingezahlt gegen mit Zins" statt „Zinseszins erklären".
- Sie bauen aufeinander auf. Abschnitt 1 nennt das Problem des Zuschauers und
  wirft die erste Frage auf. Der letzte dreht die Haltung, statt
  zusammenzufassen.
- Keine Empfehlung, nirgends. Dieses Video erklärt, es rät nicht.

DIE MUSIK:
- Genau EIN Teppich für das ganze Video, und er ist Musik, keine Umgebung.
  Unter einem Diagramm gibt es nichts, was klingt — ein Raumton unter einer
  Zinskurve behauptet einen Ort, den es nicht gibt.
- Ruhig, leise, gleichbleibend. Weiche Flächen, ein tiefer Puls. Keine
  Melodie, die man mitsummt, kein Aufbau, kein Schlagzeug.
- "prompt" auf Englisch, "seconds" zwischen 12 und 20.

Antworte mit einem JSON-Objekt, sonst nichts:
{"title":"…",
 "sections":[{"title":"…","brief":"…"}],
 "loops":[{"question":"…","raise":1,"answer":4}],
 "beds":[{"key":"…","name":"…","prompt":"…","seconds":16}]}

- "raise" und "answer" sind Abschnittsnummern, ab 1 gezählt.
- "question" ist die Frage in EINEM Satz, so wie sie im Video hängen bleibt.`;

/**
 * Was das gewählte Format vom Skript verlangt.
 *
 * Fünf verschiedene Skelette, keine fünf Etiketten: ein Fehler-Video baut auf
 * einer Zahl auf, die weh tut, ein Was-wäre-wenn auf einer Entscheidung, die
 * jemand nicht getroffen hat. Vorher gab es genau eine Sorte, und die klang
 * bei jedem Thema gleich — weil sie es war.
 */
const FORMAT_RULES: Record<FinanceFormat, string> = {
  fehler: `DAS FORMAT — DER FEHLER:
- Es geht um etwas, das die meisten falsch machen, und darum, was es kostet.
- Der Einstieg nennt den Preis des Fehlers, bevor er den Fehler nennt.
- Drei bis fünf Fehler, vom kleinsten zum teuersten. Sag früh, dass der
  letzte der teuerste ist, aber nicht welcher es ist.
- Jeder Fehler bekommt eine Zahl. Ein Fehler ohne Preis ist eine Meinung.
- Der Zuschauer soll sich bei mindestens einem wiedererkennen. Beschreib ihn
  so, wie er sich anfühlt, wenn man ihn macht — er fühlt sich nämlich richtig an.`,

  vergleich: `DAS FORMAT — DIE GEGENÜBERSTELLUNG:
- Zwei Wege, dieselbe Frage, echte Zahlen. Beide Seiten kommen fair vor.
- Sag NICHT im Einstieg, welche Seite gewinnt. Das ist die Frage, die das
  Video zusammenhält.
- Es gibt einen Punkt, an dem es kippt — eine Haltedauer, eine Summe, ein
  Zinssatz. Den zu finden ist der Zweck des Videos.
- Am Ende steht keine Empfehlung, sondern die Bedingung: unter welchen
  Umständen die eine Seite gewinnt und unter welchen die andere.`,

  untersuchung: `DAS FORMAT — DIE UNTERSUCHUNG:
- Was etwas WIRKLICH kostet oder wirklich tut, hinter dem, was draufsteht.
- Der Einstieg nennt, was draufsteht. Der Rest zeigt, was darunter liegt.
- Arbeite dich von der sichtbaren Zahl zur unsichtbaren vor, Schritt für
  Schritt. Jeder Schritt ist eine Position, die vorher niemand genannt hat.
- Keine Anschuldigung, keine Namen von Anbietern. Es geht um eine Bauart,
  nicht um einen Schuldigen — und die Zahlen reichen völlig.`,

  wenn: `DAS FORMAT — WAS WÄRE WENN:
- Eine Entscheidung wird durchgerechnet, die jemand getroffen oder gelassen
  hat. „Du hättest 2007 gekauft."
- Setz eine konkrete Person mit konkreten Zahlen fest und bleib bei ihr.
  Alter, Einkommen, Betrag, Jahr. Sie ist erfunden, ihre Zahlen sind es nicht.
- Erzähl chronologisch. Der Reiz ist, dass der Zuschauer weiß, was kommt, und
  die Person nicht.
- Am Ende steht die Zahl, um die es die ganze Zeit ging — und daneben die,
  die dabei herausgekommen wäre, wenn sie es anders gemacht hätte.`,

  system: `DAS FORMAT — DAS SYSTEM:
- Warum etwas so ist, wie es ist, und wer daran verdient.
- Der Einstieg ist etwas, das der Zuschauer für normal hält, und der Hinweis,
  dass es das nicht ist.
- Zeig den Geldfluss: wo es hereinkommt, wo es abgezweigt wird, wo es ankommt.
- Benenne die Seiten. Ein Erklärstück, in dem niemand verdient und niemand
  zahlt, erklärt nichts.
- Kein Empörungston. Die Zahlen sind stark genug, wenn sie stimmen.`,
};

export function buildFinanceOutlinePrompt(args: {
  topic: string;
  minutes: number;
  sections: number;
  beds: number;
  format: FinanceFormat;
  known?: { key: string; name: string; description: string; seconds: number }[];
  research?: string;
}): string {
  const known = args.known?.length
    ? `

DIESE KLANGTEPPICHE GIBT ES SCHON. Nimm sie, wo sie passen — sie sind bereits
erzeugt und bezahlt:
${args.known
  .map((k) => `- key: ${k.key}\n  name: ${k.name}\n  prompt: ${k.description}`)
  .join("\n")}

Übernimm einen davon WÖRTLICH mit allen drei Feldern, wenn er passt. Eine
geänderte Beschreibung gilt als neuer Klang und wird neu erzeugt.`
    : "";

  const facts = args.research?.trim()
    ? `

DIESE FAKTEN WURDEN RECHERCHIERT UND BELEGT. Bau die Gliederung um sie herum:
${args.research.trim()}

Jeder Abschnitt muss auf mindestens einem dieser Fakten stehen — nenn ihn im
"brief" mit Zahl. Ein Abschnitt ohne Fakt gehört nicht ins Video.`
    : "";

  return `Thema des Videos:
${args.topic}${facts}

${FORMAT_RULES[args.format]}

Plane genau ${args.sections} Abschnitte für ${args.minutes} Minuten Video,
2 bis 3 offene Fragen und ${args.beds} Klangteppiche.

Der Titel ist der Titel des Videos, nicht die Überschrift eines Abschnitts.${known}`;
}

export type OpenLoop = { question: string; raise: number; answer: number };

export function buildFinanceSectionPrompt(args: {
  topic: string;
  format: FinanceFormat;
  sections: { title: string; brief: string }[];
  /** Die geplanten offenen Fragen, ab 1 gezählt. Siehe die Gliederung. */
  loops: OpenLoop[];
  index: number;
  words: number;
  beds: { key: string; name: string }[];
  knownAccents?: {
    key: string;
    name: string;
    description: string;
    seconds: number;
  }[];
  research?: string;
}): string {
  const facts = args.research?.trim()
    ? `

BELEGTE FAKTEN. Nur aus diesen darfst du Zahlen, Daten und Namen nehmen:
${args.research.trim()}

Nimm die, die zu DEINEM Abschnitt gehören. Erfinde keine Zahl, die hier nicht
steht. Die Quelle nach dem senkrechten Strich wird NICHT vorgelesen — sie
gehört ins Feld "source" der Szene, die die Zahl zeigt.`
    : `

DU HAST KEINE FAKTENLISTE. Dann gilt: nimm nur Zahlen, die du sicher weißt,
und rechne den Rest selbst aus. Jede gerechnete Zahl bekommt "source":
"Eigene Rechnung" mit der Annahme dazu.`;

  const accents = args.knownAccents?.length
    ? `

DIESE GERÄUSCHE GIBT ES SCHON. Falls du überhaupt eines brauchst — siehe
KLANG, die Vorgabe ist keins — nimm eines von hier und übernimm "key", "name"
und "prompt" WÖRTLICH. Dann wird die vorhandene Datei benutzt statt neu
erzeugt, und der Akzent kostet nichts:
${args.knownAccents
  .map((a) => `- key: ${a.key}\n  name: ${a.name}\n  prompt: ${a.description}`)
  .join("\n")}`
    : "";

  const beds = args.beds.length
    ? `

DIE MUSIK DIESES VIDEOS (trag diesen "key" bei JEDER Einstellung in "ambience" ein):
${args.beds.map((b) => `- ${b.key} (${b.name})`).join("\n")}`
    : "";

  /**
   * Die offenen Fragen aus der Sicht DIESES Abschnitts.
   *
   * Drei Rollen, und sie sind nicht austauschbar: eine Frage aufwerfen heißt,
   * sie ausdrücklich nicht zu beantworten; eine offen gebliebene Frage darf
   * gestreift, aber nicht gelöst werden; und eine zu beantwortende ist der
   * Grund, warum jemand bis hierher geblieben ist.
   */
  const nr = args.index + 1;
  const stellen = args.loops.filter((l) => l.raise === nr);
  const loesen = args.loops.filter((l) => l.answer === nr);
  const offen = args.loops.filter((l) => l.raise < nr && l.answer > nr);

  const rollen = [
    ...stellen.map(
      (l) => `- AUFWERFEN und NICHT beantworten: „${l.question}"
  Formulier sie so, dass sie hängen bleibt, und geh dann weiter. Kein
  Andeuten der Antwort, kein „dazu gleich mehr". Sie wird in Abschnitt
  ${l.answer} beantwortet, nicht hier.`,
    ),
    ...offen.map(
      (l) => `- BLEIBT OFFEN: „${l.question}"
  Aufgeworfen in Abschnitt ${l.raise}, beantwortet in ${l.answer}. Du darfst
  sie streifen und den Druck erhöhen. Du beantwortest sie NICHT.`,
    ),
    ...loesen.map(
      (l) => `- BEANTWORTEN: „${l.question}"
  Aufgeworfen in Abschnitt ${l.raise}. Der Zuschauer wartet seit dort darauf.
  Die Antwort kommt klar und mit einer Zahl, und sie muss das Warten wert
  gewesen sein.`,
    ),
  ];

  const loops = rollen.length
    ? `

DIE OFFENEN FRAGEN DIESES VIDEOS — das ist keine Anregung, sondern der Aufbau:
${rollen.join("\n")}`
    : "";

  const plan = args.sections
    .map(
      (section, i) =>
        `${i + 1}. ${section.title} — ${section.brief}${
          i === args.index ? "   <<< DIESEN schreibst du" : ""
        }`,
    )
    .join("\n");

  // Eine Szene je knapp sechs Sekunden. Vorher vier je Minute (eine alle
  // fünfzehn Sekunden), dann acht — und es waren im fertigen Video immer noch
  // oft zehn. Zehn je Minute plus die Schritte innerhalb einer Szene ergeben
  // eine Bewegung alle drei bis vier Sekunden.
  const scenes = Math.max(2, Math.round((args.words / WORDS_PER_MINUTE) * 10));

  return `Thema des Videos:
${args.topic}

${FORMAT_RULES[args.format]}${facts}${loops}

DER PLAN DES GANZEN VIDEOS:
${plan}

Schreib NUR Abschnitt ${args.index + 1}. Nicht die anderen, nicht ihre
Inhalte, und keine Zusammenfassung des Ganzen.${
    args.index === 0
      ? " Es ist der Anfang: der erste Satz sagt, was das mit dem Geld des Zuschauers zu tun hat."
      : ""
  }

LÄNGE: ungefähr ${args.words} Wörter, das sind etwa ${Math.round(
    args.words / 10,
  )} Einstellungen auf ungefähr ${scenes} Szenen.

RECHNE NACH, BEVOR DU ANFÄNGST: ${Math.round(
    args.words / 10,
  )} Einstellungen auf ${scenes} Szenen sind im Schnitt ${(
    Math.round(args.words / 10) / scenes
  ).toFixed(1)} Sätze je Szene, also rund ${(
    (Math.round(args.words / 10) / scenes) *
    3.8
  ).toFixed(0)} Sekunden je Szene. Führ beim Schreiben mit, wieviele Sätze du
auf der laufenden Szene schon hast. Bist du bei drei, ist der nächste Satz
eine neue Szene — es sei denn, die laufende hat noch einen Teil, der noch
nicht dran war.

${SCENE_SHAPES}${beds}${accents}`;
}

export const FINANCE_IMPORT_SYSTEM_PROMPT = `Du bebilderst ein fertiges deutsches Finanzskript.

DAS SKRIPT IST FERTIG. Du schreibst keinen Text. Du änderst keinen Text. Du
kürzt nichts, glättest nichts, fasst nichts zusammen und schlägst nichts vor.
Der gesprochene Text steht Wort für Wort fest und wird von jemand anderem
geschrieben — deine einzige Aufgabe ist, zu entscheiden, WAS DAZU AUF DEM
SCHIRM STEHT.

Du bekommst die Sätze durchnummeriert. Du lieferst Szenen und sagst, welche
Sätze zu welcher Szene gehören. Die Sätze selbst gibst du NICHT zurück.

WELCHE SÄTZE ZUSAMMENGEHÖREN:
- Eine Szene deckt eine Spanne aufeinanderfolgender Sätze ab. Zwei bis drei
  Sätze sind der Normalfall, vier die Obergrenze.
- Die Spannen decken das ganze Skript lückenlos ab: der erste fängt bei Satz 0
  an, der letzte hört beim letzten Satz auf, keine Lücke, keine Überschneidung.
- Getrennt wird dort, wo der Gedanke wechselt — nicht nach Länge.
- Eine Szene hat höchstens so viele Teile, wie ihre Spanne Sätze hat: die
  Grafik entsteht Schritt für Schritt, ein Teil je Satz.

DIE ZAHLEN KOMMEN AUS DEM TEXT:
- Nenne in einer Grafik NUR Zahlen, die in den Sätzen dieser Spanne stehen
  oder sich aus ihnen ausrechnen lassen. Erfinde keine Zahl, die im Skript
  nicht vorkommt — sie stünde im Bild, während etwas anderes gesagt wird.
- Steht in einer Spanne keine Zahl, nimm "aussage". Das ist die richtige
  Antwort und keine Ausweichlösung.
- "source" bei Zahlen aus dem Text: "Aus dem Skript".

DIE ÜBERSCHRIFT einer Szene ist die Aussage der Sätze, die sie trägt, in
eigenen Worten und höchstens 90 Zeichen. Das ist kein Zitat und kein
Untertitel — der Text wird ja gesprochen.

DIE MUSIK:
- Genau EIN Teppich für das ganze Video, und er ist Musik, keine Umgebung.
  Unter einem Diagramm gibt es nichts, was klingt — ein Raumton unter einer
  Zinskurve behauptet einen Ort, den es nicht gibt.
- Ruhig, leise, gleichbleibend. Weiche Flächen, ein tiefer Puls. Keine
  Melodie, die man mitsummt, kein Aufbau, kein Schlagzeug.
- "prompt" auf Englisch, "seconds" zwischen 12 und 20.
- Wo er läuft, entscheidet nicht du: er liegt unter dem ganzen Video.

Antworte mit einem JSON-Objekt, sonst nichts:
{"title":"…",
 "bed":{"key":"…","name":"…","prompt":"…","seconds":16},
 "scenes":[{"key":"…","name":"…","type":"…","headline":"…", …}],
 "spans":[{"from":0,"to":2,"scene":"…"}]}

- "from" und "to" sind Satznummern, beide einschließlich.
- Jede "scene" in spans MUSS als "key" in scenes vorkommen.
- "title" ist ein Titel für das ganze Video.`;

export function buildFinanceImportPrompt(args: {
  sentences: string[];
  /**
   * Musik, die es schon gibt. Höchstens eine wird angeboten.
   *
   * Gibt es sie, wird sie wörtlich übernommen und kostet nichts. Gibt es
   * keine, schreibt das Modell eine — sonst wäre ein eingefügtes Skript das
   * einzige Video ohne Ton, und genau das war der Fehler.
   */
  beds: { key: string; name: string; description: string }[];
}): string {
  const lines = args.sentences.map((s, i) => `${i}\t${s}`).join("\n");
  const bed = args.beds[0];
  const beds = bed
    ? `\n\nDIESE MUSIK GIBT ES SCHON — nimm sie als "bed" WÖRTLICH mit allen
Feldern und schreib den Prompt nicht um, auch nicht ein bisschen. Eine
geänderte Beschreibung gilt als neue Musik und wird neu erzeugt und bezahlt:
{"key":"${bed.key}","name":"${bed.name}","prompt":"${bed.description}"}`
    : `\n\nEs gibt noch keine Musik für diesen Kanal. Schreib eine: ein "bed"
nach den Regeln oben.`;

  return `DAS FERTIGE SKRIPT, durchnummeriert:
${lines}

Es sind ${args.sentences.length} Sätze, also Nummern 0 bis ${
    args.sentences.length - 1
  }. Deck sie lückenlos mit Spannen ab.

${SCENE_SHAPES}${beds}`;
}
