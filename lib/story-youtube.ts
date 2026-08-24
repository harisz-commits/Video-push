import { parseJsonObject } from "./json";
import { complete, type JsonSchema } from "./llm";
import { shortSeconds, type StoryProject } from "./story";
import type { TextModel } from "./text-models";

/**
 * Titel und Beschreibung für den Upload.
 *
 * Der letzte Schritt und der billigste: das Video existiert, das Skript liegt
 * vor, die Fakten sind belegt. Was hier entsteht, ist eine Zusammenfassung
 * von etwas, das schon da ist — deshalb reicht dafür das kleinste Modell, und
 * deshalb ist die Vorgabe ein Lite-Modell und nicht das, das den Film
 * geschrieben hat.
 *
 * Die Kapitelmarken sind der eigentliche Grund, das hier zu machen statt es
 * von Hand zu tippen: die Zeiten stehen gemessen in `cues`, und YouTube
 * verlangt sie auf die Sekunde genau, sonst zeigt es gar keine an.
 */

/** YouTube schneidet den Titel in der Suche hart ab. */
export const TITLE_LIMIT = 100;
/** Wieviele Titel zur Auswahl geschrieben werden. */
export const TITLE_OPTIONS = 3;
/** Kapitel darunter lohnen sich nicht — YouTube verlangt mindestens drei. */
const MIN_CHAPTERS = 3;
/** YouTubes eigene Regel: das erste Kapitel muss bei 0:00 stehen. */
const FIRST_CHAPTER_SECONDS = 0;

export const SYSTEM_PROMPT = `Du schreibst Titel und Beschreibung für den YouTube-Upload eines fertigen deutschen Erklärvideos.

Du bekommst den gesprochenen Text des Videos, die belegten Fakten und die
Zeiten. Du erfindest nichts dazu — alles, was du schreibst, steht im Video.

DIE TITEL:
- Schreib ${TITLE_OPTIONS} verschiedene zur Auswahl. Verschieden heißt: nicht
  dieselbe Aussage anders formuliert.
- Höchstens ${TITLE_LIMIT} Zeichen, besser unter 70 — länger schneidet YouTube ab.
- Das Konkreteste aus dem Video gehört nach vorn: die Zahl, der Ort, das
  Ereignis. Die ersten drei Wörter entscheiden.
- KEIN Clickbait, den das Video nicht einlöst. Kein "Das wirst du nicht
  glauben", kein "Niemand spricht darüber", keine reißerischen Großbuchstaben,
  keine Emojis im Titel.
- Eine Frage nur, wenn das Video sie wirklich beantwortet.

DIE BESCHREIBUNG:
- Erster Absatz: zwei bis drei Sätze, die sagen, was drin ist. Sie stehen in
  der Suche und über dem "mehr ansehen" — der erste Satz muss allein tragen.
- Danach ein Absatz mit dem, was im Video konkret vorkommt: die Zahlen, die
  Namen, die Wendepunkte. Stichpunkte sind erlaubt.
- Kein "Vergiss nicht zu abonnieren", kein "Schreib in die Kommentare".
- Insgesamt höchstens 250 Wörter. Kein Titel wiederholt, keine Hashtags im
  Text — die kommen getrennt.

DIE SPRACHE — gilt hier genauso wie im Skript:
- Höchstens ein Adjektiv je Satz, meistens keines.
- Jeder Fachbegriff wird beim ersten Vorkommen erklärt oder weggelassen.
- Historische Geldbeträge immer mit dem heutigen Gegenwert im selben Satz.
- Keine Stimmungsmalerei. Verben tragen den Satz.

DIE KAPITEL:
- Du bekommst die Einstellungen mit ihrer Startzeit. Wähl die Stellen, an
  denen das Video etwas Neues anfängt.
- "seconds" ist die Startzeit in ganzen Sekunden, "label" die Überschrift:
  höchstens 40 Zeichen, sagt was kommt, keine Nummerierung.
- Das erste Kapitel MUSS bei 0 Sekunden stehen.
- Zwischen ${MIN_CHAPTERS} und 10 Kapitel, mindestens 25 Sekunden auseinander.
- Bekommst du keine Zeiten, lass "chapters" leer.

DIE TAGS:
- 8 bis 15 Stück, kleingeschrieben, ohne Rautezeichen.
- Wörter, nach denen jemand sucht, der dieses Video sucht — nicht Wörter, die
  im Video vorkommen.

Antworte mit einem JSON-Objekt, sonst nichts:
{"titles":["…"],"description":"…","chapters":[{"seconds":0,"label":"…"}],"tags":["…"]}`;

export function buildPrompt(project: StoryProject): string {
  const text = project.shots.map((s) => s.text.trim()).join(" ");

  const facts = project.research?.trim()
    ? `\n\nBELEGTE FAKTEN, aus denen das Video geschrieben wurde:\n${project.research.trim()}`
    : "";

  // Ohne cues gibt es keine gemessenen Zeiten, und geschätzte wären hier
  // schlimmer als keine: eine Kapitelmarke, die zwei Sekunden danebenliegt,
  // springt mitten in den vorigen Satz.
  const timed = project.cues?.length === project.shots.length;
  const timeline = timed
    ? `\n\nDIE EINSTELLUNGEN MIT STARTZEIT (Sekunde, Text):\n${project.shots
        .map((s, i) => `${Math.round(project.cues![i])}\t${s.text.trim()}`)
        .join("\n")}`
    : "\n\nEs gibt keine gemessenen Zeiten. Lass \"chapters\" leer.";

  const seconds = timed
    ? Math.round(
        project.cues![project.shots.length - 1] +
          shortSeconds(project, project.shots.length - 1, project.shots.length - 1),
      )
    : undefined;

  return `Thema: ${project.topic}
Arbeitstitel: „${project.title}"${
    seconds ? `\nLänge: ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}` : ""
  }${facts}

DER GESPROCHENE TEXT DES VIDEOS:
${text}${timeline}

Schreib Titel, Beschreibung, Kapitel und Tags.`;
}

export type ListingDraft = {
  titles: string[];
  description: string;
  chapters: { seconds: number; label: string }[];
  tags: string[];
};

/**
 * Die Form, an die sich die Antwort halten muss.
 *
 * Erzwungen statt erbeten. Ohne das kam aus einem Lauf ein Titel-Array
 * zurück, dessen erster Eintrag kein Anführungszeichen hatte, und der Fehler
 * war nicht ein schlechter Titel, sondern ein verlorener Aufruf: „Unexpected
 * token 'S'".
 *
 * Klein genug, dass es sich lohnt — vier Felder mit flachen Werten. Das
 * Skript selbst steht bewusst NICHT unter Schema; dort wären es dreißig
 * Felder, und beide Anbieter werden damit langsamer und schlechter.
 */
const LISTING_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    titles: {
      type: "array",
      items: { type: "string" },
      minItems: 1,
      maxItems: TITLE_OPTIONS,
    },
    description: { type: "string" },
    chapters: {
      type: "array",
      items: {
        type: "object",
        properties: {
          seconds: { type: "integer" },
          label: { type: "string" },
        },
        required: ["seconds", "label"],
        additionalProperties: false,
      },
    },
    tags: { type: "array", items: { type: "string" } },
  },
  required: ["titles", "description", "chapters", "tags"],
  additionalProperties: false,
};

export async function writeListing(args: {
  project: StoryProject;
  model: TextModel;
  apiKey: string;
}): Promise<{
  listing: ListingDraft;
  usage: { input: number; output: number };
}> {
  const reply = await complete({
    model: args.model,
    apiKey: args.apiKey,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildPrompt(args.project) }],
    maxTokens: 4000,
    effort: "low",
    schema: LISTING_SCHEMA,
  });

  return { listing: parseListing(reply.text, args.project), usage: reply.usage };
}

/**
 * Die Antwort des Modells, auf das reduziert, was YouTube annimmt.
 *
 * Getrennt vom Aufruf, damit sie ohne API-Schlüssel prüfbar ist — jede Regel
 * hier ist eine, an der YouTube sonst still scheitert.
 */
export function parseListing(raw: string, project: StoryProject): ListingDraft {
  const json = parseJsonObject(raw) as {
    titles?: unknown;
    description?: unknown;
    chapters?: unknown;
    tags?: unknown;
  };

  const titles = (Array.isArray(json.titles) ? json.titles : [])
    .filter((t): t is string => typeof t === "string" && t.trim().length > 3)
    .map((t) => shorten(t.trim()))
    .filter((t, i, all) => all.indexOf(t) === i)
    .slice(0, TITLE_OPTIONS);
  if (!titles.length) throw new Error("Die Antwort enthielt keinen Titel.");

  const description =
    typeof json.description === "string" ? json.description.trim().slice(0, 4500) : "";
  if (description.length < 20) {
    throw new Error("Die Antwort enthielt keine Beschreibung.");
  }

  return {
    titles,
    description,
    chapters: cleanChapters(json.chapters, project),
    tags: (Array.isArray(json.tags) ? json.tags : [])
      .filter((t): t is string => typeof t === "string" && t.trim().length > 1)
      .map((t) => t.trim().toLowerCase().replace(/^#/, "").slice(0, 40))
      .filter((t, i, all) => all.indexOf(t) === i)
      .slice(0, 15),
  };
}

/**
 * Ein zu langer Titel, an einer Wortgrenze gekürzt.
 *
 * Nicht verworfen: schreibt das Modell alle drei zu lang, stünde sonst gar
 * keiner da. Und nicht hart abgeschnitten — ein Titel, der mitten im Wort
 * endet, sieht aus wie ein Fehler und würde trotzdem einmal ausgewählt.
 */
function shorten(title: string): string {
  if (title.length <= TITLE_LIMIT) return title;
  const cut = title.slice(0, TITLE_LIMIT - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > TITLE_LIMIT / 2 ? cut.slice(0, space) : cut).replace(/[\s—–-]+$/, "")}…`;
}

/**
 * Kapitelmarken, die YouTube auch annimmt.
 *
 * YouTube zeigt gar keine Kapitel an, wenn eine der drei Bedingungen verletzt
 * ist — erstes bei 0:00, mindestens drei, keins kürzer als zehn Sekunden. Ein
 * Modell, dem man das sagt, hält sich meistens daran; „meistens" heißt hier
 * aber, dass die Kapitel still verschwinden, und niemand sähe, woran es lag.
 * Also wird nachgerechnet statt vertraut.
 */
function cleanChapters(
  raw: unknown,
  project: StoryProject,
): { seconds: number; label: string }[] {
  if (!Array.isArray(raw)) return [];
  // Gemessen bis zum ENDE des Films, nicht bis zum Anfang der letzten
  // Einstellung: die letzte Einstellung ist oft die Pointe, und genau dort
  // gehört eine Marke hin. Die zehn Sekunden Abstand sind YouTubes eigene
  // Mindestlänge für ein Kapitel.
  const end = project.cues?.length
    ? project.cues[project.cues.length - 1] +
      shortSeconds(project, project.shots.length - 1, project.shots.length - 1)
    : undefined;

  const marks = raw
    .map((c) => {
      const item = c as { seconds?: unknown; label?: unknown };
      const seconds = Math.max(0, Math.round(Number(item.seconds)));
      const label = typeof item.label === "string" ? item.label.trim().slice(0, 40) : "";
      return { seconds, label };
    })
    .filter((c) => Number.isFinite(c.seconds) && c.label.length > 1)
    .filter((c) => end === undefined || c.seconds <= end - 10)
    .sort((a, b) => a.seconds - b.seconds);

  const kept: { seconds: number; label: string }[] = [];
  for (const mark of marks) {
    const prev = kept[kept.length - 1];
    if (prev && mark.seconds - prev.seconds < 10) continue;
    kept.push(mark);
  }

  if (kept.length < MIN_CHAPTERS) return [];
  // Das erste rutscht auf 0:00 statt verworfen zu werden: ein Modell, das bei
  // 4 Sekunden anfängt, hat die Stelle richtig gewählt und nur die Regel
  // übersehen.
  kept[0] = { ...kept[0], seconds: FIRST_CHAPTER_SECONDS };
  return kept.slice(0, 10);
}
