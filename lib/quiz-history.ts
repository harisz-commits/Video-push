import { list } from "@vercel/blob";
import { formatOf } from "./formats";
import type { QuizProject } from "./quiz";
import { resolveBlobToken } from "./store";
import type { ProjectRecord } from "./projects";

/**
 * What has already been asked.
 *
 * The reason this module exists: "Allgemeinwissen" produces the same quiz
 * every time. Not because the model is broken — because the prompt is
 * identical on every run, and a model asked the same question twice gives its
 * most likely answer twice. Its most likely answer to "write general knowledge
 * questions" is the canonical trivia set, which is why the spider's legs and
 * the seven continents kept coming back.
 *
 * A model cannot avoid repeating itself if nobody tells it what it said last
 * time. So it gets told. Every question in every quiz already saved is handed
 * over as a list to stay away from — the same trick the single-question rewrite
 * has always used within one quiz, widened to all of them.
 *
 * This is a best-effort read. If storage is unreachable or slow the quiz is
 * still written, only without the memory; a generation that fails because the
 * history could not be loaded would be a much worse trade.
 */

/** How many saved projects to look at, newest first. */
const PROJECTS = 40;

/**
 * How much of the prompt the ban list may take up, in characters.
 *
 * Every one of these is paid for on every generation, so the list is bounded
 * rather than complete. Six thousand characters is roughly 1,800 tokens —
 * about a fifth of a cent on the cheap models — and holds several hundred
 * questions, which is far more than a topic has distinct easy answers.
 */
const BUDGET = 6000;

export type AskedQuestions = {
  /** Question texts, newest first, already trimmed to the budget. */
  prompts: string[];
  /** How many were found before trimming, for reporting. */
  total: number;
};

export async function askedQuestions(): Promise<AskedQuestions> {
  const token = resolveBlobToken()?.value;
  if (!token) return { prompts: [], total: 0 };

  let blobs: { url: string; uploadedAt: Date }[];
  try {
    const page = await list({ prefix: "projects/", limit: 200, token });
    blobs = page.blobs;
  } catch {
    return { prompts: [], total: 0 };
  }

  // Newest first, and only as many as the budget can ever use. Reading a
  // hundred documents to throw ninety away would put a minute of latency in
  // front of every quiz.
  const newest = [...blobs]
    .sort((a, b) => Number(b.uploadedAt) - Number(a.uploadedAt))
    .slice(0, PROJECTS);

  const records = await Promise.all(
    newest.map((blob) =>
      fetch(`${blob.url}?ts=${Date.now()}`, { cache: "no-store" })
        .then((r) => (r.ok ? (r.json() as Promise<ProjectRecord>) : null))
        .catch(() => null),
    ),
  );

  const seen = new Set<string>();
  const prompts: string[] = [];
  for (const record of records) {
    if (!record?.project || formatOf(record.project) !== "quiz") continue;
    for (const question of (record.project as QuizProject).questions) {
      // Deduplicated on a normalised form, because the same question comes
      // back with different punctuation and a ban list that lists it twice
      // wastes the budget it is bounded by.
      const key = normalise(question.prompt);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      prompts.push(question.prompt);
    }
  }

  return { prompts: fit(prompts), total: prompts.length };
}

/** Strip everything two spellings of one question can disagree about. */
function normalise(prompt: string): string {
  return prompt
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** As many as fit in the budget, newest first. */
function fit(prompts: string[]): string[] {
  const out: string[] = [];
  let used = 0;
  for (const prompt of prompts) {
    used += prompt.length + 3;
    if (used > BUDGET) break;
    out.push(prompt);
  }
  return out;
}

/**
 * Subject areas, for shaking a vague topic loose.
 *
 * The ban list stops a question coming back; it does not stop the model
 * heading for the same corner of the same subject and finding the next most
 * obvious question there. Naming a handful of areas at random does — it moves
 * where the model starts looking, which costs nothing and works on the very
 * first quiz, before there is any history to avoid.
 *
 * Only used for topics broad enough to have corners. "Flaggen der Welt" needs
 * no help finding its subject.
 */
const AREAS = [
  "Astronomie und Raumfahrt",
  "Anatomie und Medizin",
  "Chemie und Werkstoffe",
  "Physik im Alltag",
  "Tiere und ihr Verhalten",
  "Pflanzen und Pilze",
  "Erdkunde: Flüsse, Gebirge, Meere",
  "Hauptstädte und Länder",
  "Antike: Griechenland, Rom, Ägypten",
  "Mittelalter",
  "20. Jahrhundert",
  "Deutsche Geschichte",
  "Erfindungen und Technikgeschichte",
  "Malerei und Bildhauerei",
  "Klassische Musik",
  "Popmusik und Bands",
  "Film und Fernsehen",
  "Literatur und berühmte Bücher",
  "Mythologie und Sagen",
  "Sport und Rekorde",
  "Olympische Spiele",
  "Essen, Trinken und Herkunft von Gerichten",
  "Sprache, Redewendungen und Herkunft von Wörtern",
  "Mathematik und Zahlen",
  "Wirtschaft, Geld und Währungen",
  "Architektur und Bauwerke",
  "Verkehr: Schiffe, Züge, Flugzeuge",
  "Wetter und Klima",
  "Meere und Tiefsee",
  "Computer und Internet",
];

/**
 * Whether a topic is broad enough to need the nudge.
 *
 * Two conditions, and both are needed.
 *
 * It has to actually ask for general knowledge. Shortness alone is not the
 * signal — "Flaggen der Welt" is three words and names its subject exactly,
 * and pushing "Film und Fernsehen" into it would wreck the quiz rather than
 * vary it. Only a topic that declines to name a subject gets one drawn for it.
 *
 * And it has to be short. "Allgemeinwissen, aber nur Chemie und Physik, gern
 * mit Zahlen" says general knowledge and then says exactly where to go; the
 * areas would fight instructions somebody took the trouble to write.
 */
export function isBroad(topic: string): boolean {
  const words = topic.trim().split(/\s+/).length;
  const vague =
    /\ballgemein\w*|\b(?:ver)?mischt\w*|\bgemischt\w*|quer ?beet|\btrivia\b|\bwissenstest\w*|\balles m(ö|oe)gliche\b/i;
  return words <= 6 && vague.test(topic);
}

/** A handful of areas, drawn fresh each time. */
export function drawAreas(count = 6): string[] {
  const pool = [...AREAS];
  const out: string[] = [];
  while (out.length < count && pool.length > 0) {
    out.push(...pool.splice(Math.floor(Math.random() * pool.length), 1));
  }
  return out;
}
