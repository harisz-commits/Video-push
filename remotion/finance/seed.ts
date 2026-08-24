import { StoryProject } from "../../lib/story";

/**
 * Ein Startprojekt fürs Finanz-Format, mit je einer Szene pro Typ.
 *
 * Anders als der Video-Seed absichtlich vollständig: hier ist nichts zu
 * zeichnen und nichts zu bezahlen, also ist ein Projekt mit allen zwölf
 * Szenentypen genau das, was man beim Arbeiten an den Grafiken aufmachen
 * will. Es ist zugleich die Prüfung, ob jeder Typ überhaupt rendert.
 */
export const financeSeed = StoryProject.parse({
  kind: "finanz",
  id: "finance-seed",
  topic: "Was ein ETF-Sparplan über dreißig Jahre macht",
  title: "Was ein ETF-Sparplan über dreißig Jahre macht",
  style: {
    name: "Kanal-Identität",
    directive:
      "Not used by this format — the finance scenes are drawn in code from the shared design tokens rather than generated from a prompt.",
    palette: ["#0E1A2B", "#E3B23C", "#4FB99F", "#C4452F"],
  },
  scenes: [
    {
      key: "sparrate-zahl",
      name: "Was 200 Euro im Monat werden",
      type: "zahl",
      headline: "200 Euro im Monat, dreißig Jahre lang",
      value: 244000,
      suffix: " \u20ac",
      caption: "Eingezahlt hast du davon 72.000 Euro. Der Rest ist Zins auf Zins.",
      source: "Eigene Rechnung, 7 % im Jahr",
    },
    {
      key: "zinseszins-kurve",
      name: "Die Kurve, die spät steil wird",
      type: "zinseszins",
      headline: "Die ersten zehn Jahre sehen nach nichts aus",
      sub: "200 Euro monatlich, 7 Prozent im Jahr",
      monthly: 200,
      rate: 7,
      years: 30,
      figure: "point",
    },
    {
      key: "kosten-balken",
      name: "Was Gebühren kosten",
      type: "balken",
      headline: "Ein Prozent Gebühr frisst dreißig Jahre",
      unit: "\u20ac",
      series: ["0,2 % TER", "1,2 % TER"],
      categories: [
        { label: "nach 10 J.", values: [34500, 32800] },
        { label: "nach 20 J.", values: [98000, 88000] },
        { label: "nach 30 J.", values: [244000, 208000] }
      ],
      source: "Eigene Rechnung",
    },
    {
      key: "dax-verlauf",
      name: "Der Verlauf mit den Einbrüchen",
      type: "linie",
      headline: "Jeder Einbruch sah aus wie das Ende",
      unit: "Punkte",
      labels: ["1998", "2002", "2006", "2010", "2014", "2018", "2022", "2026"],
      series: [{ name: "Index", points: [4600, 2200, 6600, 6900, 9800, 10500, 13900, 19000] }],
      markers: [{ at: 1, label: "Dotcom" }, { at: 3, label: "Finanzkrise" }],
      source: "Beispielzahlen",
    },
    {
      key: "miete-kauf",
      name: "Miete gegen Kauf",
      type: "vergleich",
      headline: "Miete oder Kauf",
      left: {
        title: "Mieten",
        rows: ["Umzug in drei Monaten m\u00f6glich", "Keine Instandhaltung", "Kein Eigenkapital gebunden"],
      },
      right: {
        title: "Kaufen",
        rows: ["Tilgung statt Miete", "Kaufnebenkosten sofort weg", "An den Ort gebunden"],
      },
      verdict: "Unter sieben Jahren Haltedauer gewinnt fast immer die Miete.",
    },
    {
      key: "kaufnebenkosten",
      name: "Vom Kaufpreis zum Gesamtpreis",
      type: "wasserfall",
      headline: "Was neben dem Kaufpreis noch dazukommt",
      start: { label: "Kaufpreis", value: 400000 },
      steps: [
        { label: "Grunderwerb", delta: 26000 },
        { label: "Notar", delta: 8000 },
        { label: "Makler", delta: 14000 }
      ],
      endLabel: "Gesamt",
      source: "Sätze in Bayern, 2026",
    },
    {
      key: "portfolio",
      name: "Wie ein Depot aufgeteilt ist",
      type: "aufteilung",
      headline: "Ein Weltdepot in drei Teilen",
      parts: [
        { label: "Industriel\u00e4nder", value: 70 },
        { label: "Schwellenl\u00e4nder", value: 20 },
        { label: "Anleihen", value: 10 }
      ],
      unit: "%",
      source: "Beispielaufteilung",
    },
    {
      key: "geldfluss",
      name: "Wohin das Gehalt geht",
      type: "fluss",
      headline: "Vom Brutto zum Depot",
      nodes: [
        { label: "Brutto", value: 4000 },
        { label: "Netto", value: 2600 },
        { label: "Nach Miete", value: 1500 },
        { label: "Sparrate", value: 400 }
      ],
    },
    {
      key: "zeitstrahl-krisen",
      name: "Die Krisen der letzten Jahrzehnte",
      type: "zeitstrahl",
      headline: "Jede Krise wirkte einmalig",
      events: [
        { year: "1987", label: "Schwarzer Montag \u2014 nach zwei Jahren aufgeholt" },
        { year: "2000", label: "Dotcom \u2014 nach dreizehn Jahren aufgeholt" },
        { year: "2008", label: "Finanzkrise \u2014 nach f\u00fcnf Jahren aufgeholt" },
        { year: "2020", label: "Corona \u2014 nach f\u00fcnf Monaten aufgeholt" }
      ],
      source: "Beispielzahlen",
    },
    {
      key: "kostentabelle",
      name: "Was die Anbieter nehmen",
      type: "tabelle",
      headline: "Dieselbe Anlage, drei Preise",
      columns: ["Anbieter", "TER", "Nach 30 J."],
      rows: [
        ["Indexfonds", "0,20 %", "244.000 \u20ac"],
        ["Mischfonds", "1,20 %", "208.000 \u20ac"],
        ["Fondspolice", "2,10 %", "180.000 \u20ac"]
      ],
      source: "Eigene Rechnung",
    },
    {
      key: "rechnung",
      name: "Die Rechnung dahinter",
      type: "formel",
      headline: "So kommt die Zahl zustande",
      steps: [
        { expression: "200 \u20ac \u00d7 12 \u00d7 30", note: "was du einzahlst" },
        { expression: "= 72.000 \u20ac", note: "ohne jeden Zins" },
        { expression: "+ 172.000 \u20ac", note: "was der Zins daraus macht" }
      ],
      result: "= 244.000 \u20ac",
    },
    {
      key: "merksatz",
      name: "Der Merksatz",
      type: "aussage",
      headline: "Das Wichtigste in einem Satz",
      text: "Zeit im Markt schl\u00e4gt den richtigen Zeitpunkt.",
      figure: "talk",
    }
  ],
  shots: [
    { id: "f1", text: "Zweihundert Euro im Monat.", image: "sparrate-zahl", motion: "in" },
    { id: "f2", text: "Nach drei\u00dfig Jahren stehen da fast eine Viertelmillion.", image: "sparrate-zahl", motion: "in" },
    { id: "f3", text: "Aber die ersten zehn Jahre sehen nach gar nichts aus.", image: "zinseszins-kurve", motion: "in" },
    { id: "f4", text: "Und genau da h\u00f6ren die meisten auf.", image: "zinseszins-kurve", motion: "in" },
    { id: "f5", text: "Ein Prozent Geb\u00fchr klingt nach nichts.", image: "kosten-balken", motion: "in" },
    { id: "f6", text: "\u00dcber drei\u00dfig Jahre sind es sechsunddrei\u00dfigtausend Euro.", image: "kosten-balken", motion: "in" },
    { id: "f7", text: "Jeder Einbruch sah aus wie das Ende.", image: "dax-verlauf", motion: "in" },
    { id: "f8", text: "Miete oder Kauf ist keine Frage des Gef\u00fchls.", image: "miete-kauf", motion: "in" },
    { id: "f9", text: "Neben dem Kaufpreis stehen noch zwei Jahresgeh\u00e4lter.", image: "kaufnebenkosten", motion: "in" },
    { id: "f10", text: "Ein Weltdepot besteht aus drei Teilen.", image: "portfolio", motion: "in" },
    { id: "f11", text: "Vom Brutto bleibt weniger, als du denkst.", image: "geldfluss", motion: "in" },
    { id: "f12", text: "Jede Krise wirkte einmalig.", image: "zeitstrahl-krisen", motion: "in" },
    { id: "f13", text: "Dieselbe Anlage kostet bei drei Anbietern drei Preise.", image: "kostentabelle", motion: "in" },
    { id: "f14", text: "So kommt die Zahl zustande.", image: "rechnung", motion: "in" },
    { id: "f15", text: "Zeit im Markt schl\u00e4gt den richtigen Zeitpunkt.", image: "merksatz", motion: "in" }
  ],
});
