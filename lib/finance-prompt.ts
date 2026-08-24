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

DER GESPROCHENE TEXT:
- Durchgehende Erzählung, kein Stichpunktzettel. Sie wird am Stück vorgelesen.
- Du-Form, niemals Sie-Form.
- Der erste Satz sagt dem Zuschauer, was das mit SEINEM Geld zu tun hat. Keine
  Begrüßung, kein "In diesem Video".
- Sachlich richtig. Bekommst du eine Faktenliste, ist sie deine EINZIGE Quelle
  für Zahlen, Daten, Namen und Renditen. Ohne Liste gilt: was du nicht sicher
  weißt, kommt nicht vor.
- Kein Fazit-Geschwafel am Ende. Der letzte Satz ist ein Gedanke, der bleibt.

KEINE ANLAGEBERATUNG — harte Regel:
- Du erklärst, wie etwas funktioniert und was die Zahlen sagen. Du empfiehlst
  NICHTS.
- Nie: "kauf", "investier in", "das solltest du nehmen", "der beste ETF ist".
- Stattdessen: "wer X macht, zahlt Y", "historisch lag Z bei", "die Rechnung
  sieht so aus".
- Nenne keine einzelnen Wertpapiere, Fonds oder ISINs als Beispiel, an dem
  sich jemand orientieren soll. Anbietertypen und Produktgattungen ja,
  konkrete Kaufempfehlungen nein.
- Vergangene Renditen werden als Vergangenheit benannt, nie als Erwartung.
  Rechnest du mit einem Prozentsatz, sag dazu, dass es eine Annahme ist.
${SPOKEN_LANGUAGE_RULES}

DIE AUFTEILUNG IN EINSTELLUNGEN ("shots"):
- Jede Einstellung ist EIN Satz und die Szene, die dazu auf dem Schirm steht.
- Im DURCHSCHNITT zehn Wörter je Einstellung, zwischen 4 und 18.
- MEHRERE EINSTELLUNGEN HINTEREINANDER AUF DERSELBEN SZENE sind der Normalfall
  und nicht die Ausnahme. Ein Diagramm baut sich in zwei Sekunden auf und
  braucht danach Ruhe: drei bis fünf Sätze auf derselben Szene sind richtig.
  Wer bei jedem Satz die Szene wechselt, zeigt Diagramme, die niemand liest.
- Erst die Szene aufbauen lassen, dann darüber reden. Der Satz, der eine Zahl
  nennt, kommt NACH dem Satz, der die Szene einführt.
- Aneinandergehängt ergeben alle Einstellungstexte den fertigen Fließtext.

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
- "aussage": ein Satz, der stehen bleibt. Definitionen, Merksätze, Übergänge.
  Nimm sie, statt ein Diagramm für etwas zu bauen, das keine Daten hat.

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

Du lieferst eine Gliederung in Abschnitten und die Klangteppiche darunter.

DIE ABSCHNITTE:
- Jeder Abschnitt muss etwas ZEIGBARES haben: eine Zahl, einen Verlauf, eine
  Aufteilung, eine Rechnung, eine Gegenüberstellung. Ein Abschnitt, aus dem
  sich keine Grafik bauen lässt, gehört nicht in dieses Format.
- Schreib in "brief", WAS gezeigt werden soll, nicht nur wovon die Rede ist:
  "Kurve über 30 Jahre, eingezahlt gegen mit Zins" statt "Zinseszins erklären".
- Sie bauen aufeinander auf. Abschnitt 1 sagt, warum das den Zuschauer
  betrifft — sein Geld, seine Miete, seine Sparrate. Der letzte lässt einen
  Gedanken stehen.
- Keine Empfehlung, nirgends. Dieses Video erklärt, es rät nicht.

DIE MUSIK:
- Genau EIN Teppich für das ganze Video, und er ist Musik, keine Umgebung.
  Unter einem Diagramm gibt es nichts, was klingt — ein Raumton unter einer
  Zinskurve behauptet einen Ort, den es nicht gibt.
- Ruhig, leise, gleichbleibend. Weiche Flächen, ein tiefer Puls. Keine
  Melodie, die man mitsummt, kein Aufbau, kein Schlagzeug. Er soll auffallen,
  wenn man ihn abschaltet, und sonst nicht.
- Er läuft unter dem ganzen Video durch. Ein Wechsel mittendrin wäre ein
  Ereignis, das der Inhalt nicht hergibt.
- "prompt" auf Englisch, "seconds" zwischen 12 und 20.

Antworte mit einem JSON-Objekt, sonst nichts:
{"title":"…","sections":[{"title":"…","brief":"…"}],
 "beds":[{"key":"…","name":"…","prompt":"…","seconds":16}]}`;

export function buildFinanceOutlinePrompt(args: {
  topic: string;
  minutes: number;
  sections: number;
  beds: number;
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

Plane genau ${args.sections} Abschnitte für ${args.minutes} Minuten Video und
${args.beds} Klangteppiche.

Der Titel ist der Titel des Videos, nicht die Überschrift eines Abschnitts.${known}`;
}

export function buildFinanceSectionPrompt(args: {
  topic: string;
  sections: { title: string; brief: string }[];
  index: number;
  words: number;
  beds: { key: string; name: string }[];
  knownAccents?: { key: string; name: string; description: string; seconds: number }[];
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

  const plan = args.sections
    .map(
      (section, i) =>
        `${i + 1}. ${section.title} — ${section.brief}${
          i === args.index ? "   <<< DIESEN schreibst du" : ""
        }`,
    )
    .join("\n");

  const scenes = Math.max(2, Math.round(args.words / WORDS_PER_MINUTE * 4));

  return `Thema des Videos:
${args.topic}${facts}

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

RECHNE NACH: ${Math.round(args.words / 10)} Einstellungen auf ${scenes} Szenen
sind im Schnitt ${(Math.round(args.words / 10) / scenes).toFixed(1)} Sätze je
Szene. Das ist so gewollt. Eine Szene je Satz wäre bei diesem Format falsch —
ein Diagramm, das nach zweieinhalb Sekunden verschwindet, wurde nicht gelesen.

${SCENE_SHAPES}${beds}${accents}`;
}
