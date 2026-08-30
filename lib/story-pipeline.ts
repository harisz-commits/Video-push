import { parseJsonObject } from "./json";
import { complete } from "./llm";
import { researchTopic } from "./story-research";
import { splitScript, textIsUnchanged } from "./script-import";
import {
  soundLibrary,
  SOUND_PROMPT_LIMIT,
  trimSoundPrompt,
  type KnownSound,
} from "./sfx";
import { slugify } from "./image-library";
import {
  ShotMotion,
  StoryProject,
  StoryStyle,
  type StoryCharacter,
  type StoryImage,
  type StoryPerspective,
  type StoryShot,
  type StorySound,
} from "./story";
import {
  buildCharacterPrompt,
  buildOutlinePrompt,
  buildSectionPrompt,
  buildStylePrompt,
  STORY_CHARACTER_SYSTEM_PROMPT,
  buildStoryImportPrompt,
  STORY_IMPORT_SYSTEM_PROMPT,
  STORY_OUTLINE_SYSTEM_PROMPT,
  STORY_SCRIPT_SYSTEM_PROMPT,
  STORY_STYLE_SYSTEM_PROMPT,
  WORDS_PER_MINUTE,
} from "./story-prompt";
import { costCents, resolveTextModel, type TextModel } from "./text-models";
import { storyJobPath, writeJson, type StoryJob } from "./store";

/**
 * Writing a video.
 *
 * Two model calls with a hard dependency between them. The look is decided
 * first, alone, from nothing but the topic; the script is then written by
 * somebody who already knows what the film looks like. Reversing that would
 * mean deriving a style from a hundred descriptions written without one, which
 * is a summary of an inconsistency rather than a fix for it.
 *
 * Nothing is drawn here. Writing costs a fraction of a cent and drawing costs
 * dollars, so the script is produced, read and — if it is wrong — thrown away
 * before any picture is paid for. Drawing is POST /api/story/images.
 */

/** Which model writes a video, unless the caller names another. */
export const DEFAULT_STORY_MODEL = "gemini-3.7-flash";

export async function generateStory(args: {
  jobId: string;
  topic: string;
  /** Target length. The script prompt turns this into words and shots. */
  minutes: number;
  /** Hard ceiling on distinct pictures. This is the money knob. */
  imageBudget: number;
  /** Only carried through to the project, for the studio to show later. */
  imagesPerMinute?: number;
  /**
   * What the person asked the look to be, in their own words.
   *
   * Ignored when `style` is given — a saved look is already a decision.
   */
  styleWish?: string;
  /**
   * A look decided earlier and kept.
   *
   * When present the style step is skipped entirely, which is the point: two
   * films sharing a look share their picture library, and a style generated
   * afresh would be a near-miss that shares nothing.
   */
  style?: StoryStyle;
  /** Figures the film should keep coming back to. See StoryCharacter. */
  characters?: { key: string; name: string; description: string }[];
  /** Whether to look the facts up before writing. See lib/story-research.ts. */
  research?: boolean;
  /** Where the viewer stands in the story. See StoryPerspective. */
  perspective?: StoryPerspective;
  apiKey: string;
  model?: TextModel;
  startedAt: number;
}): Promise<void> {
  const model = args.model ?? resolveTextModel(DEFAULT_STORY_MODEL);
  const spent = { input: 0, output: 0 };

  const progress = (step: string) =>
    writeJson(storyJobPath(args.jobId), {
      jobId: args.jobId,
      topic: args.topic,
      status: "running",
      step,
      startedAt: args.startedAt,
      updatedAt: Date.now(),
    } satisfies StoryJob).catch(() => undefined);

  try {
    /**
     * The facts, before anything is planned.
     *
     * First, and not merely early: the outline is built around these and the
     * sections write from them, so a fact arriving after the plan would have
     * nowhere to go. It gets its own budget and is never allowed to take the
     * script down with it - a film written from memory is what this format
     * did for its whole life, so falling back to that is a bad outcome and
     * not a broken one.
     */
    let research = "";
    let searches = 0;
    if (args.research !== false) {
      await progress("Fakten werden recherchiert");
      const found = await researchTopic({
        topic: args.topic,
        minutes: args.minutes,
        model,
        apiKey: args.apiKey,
        deadline: args.startedAt + RESEARCH_DEADLINE_MS,
      }).catch((err) => {
        // eslint-disable-next-line no-console
        console.error("[story] Recherche fehlgeschlagen:", err);
        return null;
      });
      if (found) {
        research = found.facts;
        searches = found.searches;
        spent.input += found.usage.input;
        spent.output += found.usage.output;
      }
    }

    // A kept look skips the style call entirely. Not merely to save the call:
    // regenerating a style from the same topic produces something adjacent
    // rather than identical, and adjacent is exactly what breaks both the
    // series and the picture library.
    let style: {
      title: string;
      style: StoryStyle;
      characters: StoryCharacter[];
    };
    if (args.style) {
      await progress("Bildstil steht fest");
      style = {
        title: args.topic.slice(0, 60),
        style: args.style,
        // Still translated into the look, because the saved look knows nothing
        // about figures that were never in it.
        characters: args.characters?.length
          ? await describeCharacters({
              model,
              apiKey: args.apiKey,
              spent,
              topic: args.topic,
              style: args.style,
              characters: args.characters,
            })
          : [],
      };
    } else {
      await progress("Bildstil wird festgelegt");
      style = await writeStyle({
        model,
        apiKey: args.apiKey,
        spent,
        topic: args.topic,
        wish: args.styleWish,
        characters: args.characters,
      });
    }

    const script = await writeScript({
      model,
      apiKey: args.apiKey,
      spent,
      topic: args.topic,
      style: style.style,
      characters: style.characters,
      research,
      perspective: args.perspective ?? "erklaerung",
      minutes: args.minutes,
      imageBudget: args.imageBudget,
      deadline: args.startedAt + WRITING_DEADLINE_MS,
      onProgress: progress,
    });

    const project = StoryProject.parse({
      kind: "video",
      id: `story-${args.jobId}`,
      topic: args.topic,
      title: style.title,
      style: style.style,
      characters: style.characters,
      imagesPerMinute: args.imagesPerMinute,
      perspective: args.perspective ?? "erklaerung",
      research: research || undefined,
      images: script.images,
      sounds: script.sounds,
      shots: script.shots,
      fps: 30,
      width: 1920,
      height: 1080,
    });

    const words = script.shots.reduce(
      (n, shot) => n + shot.text.trim().split(/\s+/).length,
      0,
    );

    await writeJson(storyJobPath(args.jobId), {
      jobId: args.jobId,
      topic: args.topic,
      status: "done",
      project,
      // Said plainly when the film came out shorter than asked for, because
      // the alternative is a silently short video that looks finished. A
      // section can be lost to the clock or to a reply that would not parse.
      warning: buildWarning({
        short: script.short,
        words,
        minutes: args.minutes,
        split: script.split,
        overused: script.overused,
        researched: args.research !== false,
        searches,
        facts: research ? research.split("\n").filter(Boolean).length : 0,
      }),

      cost: {
        model: model.id,
        label: model.label,
        inputTokens: spent.input,
        outputTokens: spent.output,
        cents: Number(costCents(model, spent).toFixed(3)),
      },
      startedAt: args.startedAt,
      updatedAt: Date.now(),
    } satisfies StoryJob);
  } catch (err) {
    await writeJson(storyJobPath(args.jobId), {
      jobId: args.jobId,
      topic: args.topic,
      status: "error",
      error: (err as Error).message.slice(0, 400),
      startedAt: args.startedAt,
      updatedAt: Date.now(),
    } satisfies StoryJob).catch(() => undefined);
  }
}

type CharacterSeed = { key: string; name: string; description: string };

/**
 * The one line the studio shows when something is off.
 *
 * Several things can be wrong at once and only one line is read, so they are
 * ordered by what costs most to ignore: a film shorter than asked for is
 * unusable, pictures on a loop are visible in every second of it, and a script
 * written without a single checked fact is the one fault that looks fine and
 * is not.
 */
function buildWarning(args: {
  short: boolean;
  words: number;
  minutes: number;
  /** Extra drawings added to break up repetition. */
  split: number;
  overused: { name: string; appearances: number }[];
  researched: boolean;
  searches: number;
  facts: number;
}): string | undefined {
  if (args.short) {
    return `Nicht alle Abschnitte wurden fertig — das Video ist ${Math.round(args.words / WORDS_PER_MINUTE)} statt ${args.minutes} Minuten lang. Erzeug es noch einmal, oder nimm eine kürzere Länge.`;
  }

  if (args.researched && args.searches === 0) {
    return "Die Websuche hat nichts geliefert, also steht in diesem Skript keine geprüfte Zahl — das Modell hat aus dem Gedächtnis geschrieben. Bei Themen mit Daten und Namen solltest du es noch einmal erzeugen.";
  }

  // Only reachable when the budget ran out — otherwise spreadOverused() has
  // already dealt with it and there is nothing to warn about.
  if (args.overused.length > 0) {
    return `${args.overused.length} Bilder kommen öfter als ${MAX_APPEARANCES}× vor — am häufigsten „${args.overused[0].name}“ mit ${args.overused[0].appearances} Auftritten. Dafür reichte das Bildbudget nicht: wähl mehr Bilder pro Minute und schreib neu.`;
  }

  if (args.split > 0) {
    return `${args.split} Bilder wurden nachträglich in Varianten aufgeteilt, damit keines öfter als ${MAX_APPEARANCES}× erscheint. Sie kosten beim Zeichnen mit.`;
  }

  if (args.researched && args.facts > 0) {
    return undefined;
  }

  return undefined;
}

async function writeStyle(args: {
  model: TextModel;
  apiKey: string;
  spent: { input: number; output: number };
  topic: string;
  wish?: string;
  characters?: CharacterSeed[];
}): Promise<{
  title: string;
  style: StoryStyle;
  characters: StoryCharacter[];
}> {
  const reply = await complete({
    model: args.model,
    apiKey: args.apiKey,
    system: STORY_STYLE_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: buildStylePrompt({
          topic: args.topic,
          wish: args.wish,
          characters: args.characters,
        }),
      },
    ],
    maxTokens: 4000,
    effort: "medium",
  });
  args.spent.input += reply.usage.input;
  args.spent.output += reply.usage.output;

  const json = parseJsonObject(reply.text) as {
    title?: unknown;
    styleName?: unknown;
    directive?: unknown;
    palette?: unknown;
    characters?: unknown;
  };

  const parsed = StoryStyle.safeParse({
    name: json.styleName,
    directive: json.directive,
    palette: Array.isArray(json.palette)
      ? json.palette.filter((c) => typeof c === "string")
      : [],
  });
  if (!parsed.success) {
    throw new Error(
      `Der Bildstil kam unbrauchbar zurück: ${parsed.error.issues[0]?.message ?? "unbekannt"}.`,
    );
  }

  return {
    title:
      typeof json.title === "string" && json.title.trim()
        ? json.title.trim().slice(0, 60)
        : args.topic.slice(0, 60),
    style: parsed.data,
    characters: mergeAppearances(args.characters ?? [], json.characters),
  };
}

/**
 * Describe already-decided figures in an already-decided look.
 *
 * Only reached when a saved look is reused: the look was kept without these
 * figures, so nothing has yet said what they look like in it. Its own call
 * rather than a flag on writeStyle(), because writeStyle() would otherwise be
 * asked to invent a style it has been handed.
 */
async function describeCharacters(args: {
  model: TextModel;
  apiKey: string;
  spent: { input: number; output: number };
  topic: string;
  style: StoryStyle;
  characters: CharacterSeed[];
}): Promise<StoryCharacter[]> {
  try {
    const reply = await complete({
      model: args.model,
      apiKey: args.apiKey,
      system: STORY_CHARACTER_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: buildCharacterPrompt({
            topic: args.topic,
            style: args.style,
            characters: args.characters,
          }),
        },
      ],
      maxTokens: 3000,
      effort: "medium",
    });
    args.spent.input += reply.usage.input;
    args.spent.output += reply.usage.output;

    const json = parseJsonObject(reply.text) as { characters?: unknown };
    return mergeAppearances(args.characters, json.characters);
  } catch {
    // The figures still exist and still reach the image prompts — just in the
    // words the person wrote rather than translated into the look. Worse, and
    // far better than losing them.
    return mergeAppearances(args.characters, []);
  }
}

/**
 * Attach each returned appearance to the figure it belongs to.
 *
 * Keyed rather than positional, and every seed survives whether or not the
 * model answered for it: a figure that silently vanished here would leave the
 * script naming a character key that no longer exists.
 */
function mergeAppearances(
  seeds: CharacterSeed[],
  raw: unknown,
): StoryCharacter[] {
  const byKey = new Map<string, string>();
  for (const item of Array.isArray(raw) ? raw : []) {
    const c = item as { key?: unknown; appearance?: unknown };
    if (typeof c.key !== "string" || typeof c.appearance !== "string") continue;
    const appearance = c.appearance.trim();
    if (appearance.length < 10) continue;
    byKey.set(slugify(c.key), appearance.slice(0, 700));
  }

  return seeds.map((seed) => ({
    key: seed.key,
    name: seed.name,
    description: seed.description,
    appearance: byKey.get(seed.key),
  }));
}

/**
 * When to stop starting new sections.
 *
 * The route is allowed 300 seconds. A section that begins at 250 will not
 * finish, and a job killed mid-write leaves nothing at all — whereas stopping
 * early leaves a shorter film that is complete as far as it goes.
 */
const WRITING_DEADLINE_MS = 250_000;

/**
 * When the research has to hand over, whatever it has found.
 *
 * Eighty seconds out of the route's three hundred. The infographics format
 * gave research a whole function of its own because searching genuinely takes
 * minutes - but that needed a second route and a handover token, and here the
 * writing that follows is thirteen calls rather than one. A hard budget with a
 * partial sheet as the fallback buys most of the value for none of that
 * machinery: five checked facts beat none, and beat a killed function.
 */
const RESEARCH_DEADLINE_MS = 80_000;

/** Minutes of video per section. Small enough that a model actually fills it. */
const MINUTES_PER_SECTION = 2;

/**
 * How many of the shared motifs one section is shown.
 *
 * Not all of them. A section offered the whole pool uses most of it, and with
 * seven sections that is seven appearances per motif before anybody has done
 * anything wrong. A rotating window means each motif reaches two or three
 * sections, which is what a recurring motif should be.
 */
const MOTIFS_PER_SECTION = 3;

/**
 * How often one picture may come back.
 *
 * Two or three appearances read as a motif. Seven read as running out of
 * pictures, which is what a viewer sees whether or not it is true - and on the
 * film that prompted this it was not true: thirty-five of the forty-one
 * pictures were used once or twice while six were used to death.
 *
 * A ceiling, not a target. Whether the arithmetic even allows it depends on
 * the picture rate, which is why the studio now shows what the rate implies.
 */
const MAX_APPEARANCES = 3;

/** How many sections are written at once. See the note in writeScript(). */
const LANES = 3;

/**
 * Write the script in sections.
 *
 * One call cannot do this. Asked for 4,000 words in a single reply, Gemini 3.7
 * Flash returned 1,160 — and not because it hit the ceiling: 10,603 of 32,000
 * output tokens. It simply stops, and returns valid, complete-looking JSON
 * that is a quarter of what was asked for. Every length above about three
 * minutes was silently short.
 *
 * So: an outline first, then each section written against it. Sections run
 * several at a time because they do not depend on each other's text — only on
 * the outline, which every one of them gets in full, and on a set of
 * recurring motifs decided up front. Those motifs are what keep the film
 * looking like one film despite being written in pieces.
 */
async function writeScript(args: {
  model: TextModel;
  apiKey: string;
  spent: { input: number; output: number };
  topic: string;
  style: StoryStyle;
  characters: StoryCharacter[];
  research: string;
  perspective: StoryPerspective;
  minutes: number;
  imageBudget: number;
  deadline: number;
  onProgress: (step: string) => Promise<unknown>;
}): Promise<{
  images: StoryImage[];
  sounds: StorySound[];
  shots: StoryShot[];
  short: boolean;
  /** How many extra drawings were added to break up repetition. */
  split: number;
  /** Pictures that come back too often, worst first. */
  overused: { name: string; appearances: number }[];
}> {
  const sectionCount = Math.max(
    1,
    Math.min(15, Math.round(args.minutes / MINUTES_PER_SECTION)),
  );

  /**
   * What the sound library already holds.
   *
   * Read once, before anything is written, and handed to both the outline and
   * every section. Sounds are the most reusable thing this studio makes —
   * wind is wind in every film — and matching them by key alone almost never
   * fired across films, because two scripts name the same sound differently.
   * Showing the writer what exists is what turns that into a hit.
   *
   * Never fatal: without the list the writer invents as it always did.
   */
  const known = await soundLibrary().catch(() => ({
    beds: [] as KnownSound[],
    accents: [] as KnownSound[],
  }));

  /**
   * The shared motifs, sized by the number of SECTIONS rather than by the
   * picture budget.
   *
   * The old rule tied the pool to the budget, and that was the wrong quantity
   * entirely: motif appearances scale with how many sections are offered them,
   * not with how many pictures the film may draw. A thirteen-minute film had
   * seven sections and a pool capped at six, every section was handed all six
   * as "these already exist, use them", and the six absorbed 51 appearances
   * while 82 other pictures appeared once each.
   *
   * Tied to sections, and each section shown only a slice of the pool (see
   * MOTIFS_PER_SECTION), a motif is offered to two or three sections rather
   * than all of them - which lands it at the two or three appearances a motif
   * is supposed to have.
   */
  const motifBudget = Math.max(3, Math.min(8, sectionCount));
  // Three to five beds for a whole film. More would not be richer, only less
  // recognisable — a bed earns its keep by coming back.
  const bedBudget = args.minutes >= 8 ? 5 : 3;
  const perSection = Math.max(
    1,
    Math.floor((args.imageBudget - motifBudget) / sectionCount),
  );

  await args.onProgress(
    sectionCount === 1
      ? "Skript wird geschrieben"
      : `Gliederung für ${sectionCount} Abschnitte`,
  );

  const plan = await writeOutline({
    ...args,
    sections: sectionCount,
    motifs: motifBudget,
    beds: bedBudget,
    known: known.beds,
    research: args.research,
  });

  const words = Math.round((args.minutes * WORDS_PER_MINUTE) / sectionCount);
  const results = new Array<{
    images: StoryImage[];
    sounds: StorySound[];
    shots: StoryShot[];
  } | null>(sectionCount).fill(null);
  let done = 0;
  let next = 0;
  let short = false;

  const lane = async () => {
    for (;;) {
      const index = next++;
      if (index >= sectionCount) return;
      if (Date.now() > args.deadline) {
        short = true;
        continue;
      }

      const reply = await complete({
        model: args.model,
        apiKey: args.apiKey,
        system: STORY_SCRIPT_SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: buildSectionPrompt({
              topic: args.topic,
              style: args.style,
              sections: plan.sections,
              index,
              words,
              // A rotating slice, not the whole pool. See MOTIFS_PER_SECTION.
              motifs:
                plan.motifs.length <= MOTIFS_PER_SECTION
                  ? plan.motifs
                  : Array.from(
                      { length: MOTIFS_PER_SECTION },
                      (_, k) =>
                        plan.motifs[
                          (index * MOTIFS_PER_SECTION + k) % plan.motifs.length
                        ],
                    ),
              beds: plan.beds,
              imageBudget: perSection,
              // What the arithmetic allows, so the writer can spread rather
              // than guess. See buildSectionPrompt().
              maxAppearances: MAX_APPEARANCES,
              characters: args.characters,
              knownAccents: known.accents,
              research: args.research,
              perspective: args.perspective,
            }),
          },
        ],
        maxTokens: 16000,
        effort: "medium",
      });
      args.spent.input += reply.usage.input;
      args.spent.output += reply.usage.output;

      try {
        const json = parseJsonObject(reply.text) as {
          images?: unknown;
          accents?: unknown;
          shots?: unknown;
        };
        results[index] = reconcile(
          json.images,
          json.shots,
          plan.motifs,
          json.accents,
          plan.beds,
          args.characters,
        );
      } catch {
        // One section that will not parse must not cost the other twelve. The
        // film is shorter by that section and says so.
        short = true;
      }

      done += 1;
      await args.onProgress(`Abschnitt ${done} von ${sectionCount}`);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(LANES, sectionCount) }, lane),
  );

  // Stitched in outline order, not in the order they came back.
  const images = new Map<string, StoryImage>();
  for (const motif of plan.motifs) images.set(motif.key, motif);
  const sounds = new Map<string, StorySound>();
  for (const bed of plan.beds) sounds.set(bed.key, bed);
  const shots: StoryShot[] = [];

  for (const result of results) {
    if (!result) continue;
    for (const image of result.images) {
      if (!images.has(image.key)) images.set(image.key, image);
    }
    for (const sound of result.sounds) {
      if (!sounds.has(sound.key)) sounds.set(sound.key, sound);
    }
    for (const shot of result.shots) {
      shots.push({ ...shot, id: `s${shots.length + 1}` });
    }
  }

  if (shots.length === 0) {
    throw new Error("Das Modell hat keinen gesprochenen Text geliefert.");
  }

  // A motif nobody used is a picture nobody should pay for.
  const used = new Set(shots.map((s) => s.image));
  // A sound nobody plays is a sound nobody should pay for.
  const heard = new Set(
    shots.flatMap((s) => [s.ambience, s.accent].filter(Boolean) as string[]),
  );
  const kept = [...images.values()].filter((i) => used.has(i.key));
  const spread = spreadOverused(kept, shots, args.imageBudget);

  return {
    images: spread.images,
    sounds: [...sounds.values()].filter((s) => heard.has(s.key)),
    shots: spread.shots,
    short,
    split: spread.split,
    overused: overusedImages(
      spread.shots,
      new Map(spread.images.map((i) => [i.key, i])),
    ),
  };
}

/**
 * Split pictures that come back too often into variations of themselves.
 *
 * The cap could never be reached by asking. It is stated per section, and the
 * sections are written in parallel by calls that know nothing about each
 * other - so seven sections each obeying "no more than three" still produce
 * twenty-one appearances of one picture, and every one of them followed its
 * instructions. Measured on a thirteen-minute film: six shared motifs
 * accounted for 51 appearances (11, 10, 9, 8, 8, 5) while 82 of the 91
 * pictures appeared exactly once.
 *
 * So it is enforced here instead, where the whole film is visible at once. A
 * picture past its allowance keeps the first three appearances and hands the
 * rest to fresh variants of itself: the same subject, drawn again from another
 * angle or another distance. That is what the viewer wanted in the first
 * place - not the same drawing eleven times, but the hearth from six different
 * sides.
 *
 * It spends picture budget, which is the honest trade: somebody who asked for
 * twelve pictures a minute asked for variety and should get it. It never
 * spends more than they asked for, and a film that has genuinely run out of
 * budget keeps its repetitions rather than silently costing more.
 */
const VARIATIONS = [
  "Show the same subject from a noticeably different angle.",
  "Show a closer view of a different part of the same subject.",
  "Show the same subject from further back, with more of its surroundings.",
  "Show a different corner of the same place.",
  "Show the same subject at a different moment, with the light changed.",
];

function spreadOverused(
  images: StoryImage[],
  shots: StoryShot[],
  budget: number,
): { images: StoryImage[]; shots: StoryShot[]; split: number } {
  // Appearances, not shots: consecutive sentences on one picture are a single
  // uninterrupted take and nobody experiences them as repetition.
  const runs: { image: string; at: number[] }[] = [];
  shots.forEach((shot, i) => {
    const open = runs[runs.length - 1];
    if (open && open.image === shot.image) open.at.push(i);
    else runs.push({ image: shot.image, at: [i] });
  });

  const total = new Map<string, number>();
  for (const run of runs) total.set(run.image, (total.get(run.image) ?? 0) + 1);
  if (![...total.values()].some((n) => n > MAX_APPEARANCES)) {
    return { images, shots, split: 0 };
  }

  const byKey = new Map(images.map((i) => [i.key, i]));
  const extra: StoryImage[] = [];
  const seen = new Map<string, number>();
  const next = shots.slice();
  let room = Math.max(0, budget - images.length);
  let split = 0;

  for (const run of runs) {
    const n = (seen.get(run.image) ?? 0) + 1;
    seen.set(run.image, n);
    if (n <= MAX_APPEARANCES) continue;
    if (room === 0) continue;

    const original = byKey.get(run.image);
    if (!original) continue;

    // A variant per group of MAX_APPEARANCES, so a picture used nine times
    // becomes three drawings rather than seven.
    const variant = Math.floor((n - 1) / MAX_APPEARANCES);
    const key = `${original.key}-${variant + 1}`;

    if (!byKey.has(key)) {
      const hint = VARIATIONS[(variant - 1) % VARIATIONS.length];
      const image: StoryImage = {
        ...original,
        key,
        name: `${original.name} (${variant + 1})`,
        prompt: `${original.prompt} ${hint}`,
      };
      byKey.set(key, image);
      extra.push(image);
      room -= 1;
      split += 1;
    }

    for (const i of run.at) next[i] = { ...next[i], image: key };
  }

  return { images: [...images, ...extra], shots: next, split };
}

/**
 * Pictures that come back more often than a viewer will forgive.
 *
 * Counted in APPEARANCES, not in shots: several sentences in a row on one
 * picture are a single long take with one continuous camera move, and nobody
 * experiences that as repetition. What they do notice is the same drawing
 * cutting back for the seventh time.
 *
 * Reported rather than repaired, because there is nothing honest to repair
 * with - swapping in a different picture would put the wrong thing on screen,
 * and the fix is either a higher picture rate or a rewrite. Both are the
 * person's call, and neither is possible if nobody tells them.
 */
function overusedImages(
  shots: StoryShot[],
  images: Map<string, StoryImage>,
): { name: string; appearances: number }[] {
  const appearances = new Map<string, number>();
  let previous: string | null = null;
  for (const shot of shots) {
    if (shot.image !== previous) {
      appearances.set(shot.image, (appearances.get(shot.image) ?? 0) + 1);
    }
    previous = shot.image;
  }

  return [...appearances.entries()]
    .filter(([, n]) => n > MAX_APPEARANCES)
    .sort((a, b) => b[1] - a[1])
    .map(([key, n]) => ({
      name: images.get(key)?.name ?? key,
      appearances: n,
    }));
}

async function writeOutline(args: {
  model: TextModel;
  apiKey: string;
  spent: { input: number; output: number };
  topic: string;
  style: StoryStyle;
  minutes: number;
  sections: number;
  motifs: number;
  beds: number;
  /** Beds already in the library, offered to the planner for reuse. */
  known?: KnownSound[];
  /** Checked facts the outline must be built around. */
  research?: string;
  /** Decides whether the plan is a chronology or a chain of questions. */
  perspective?: StoryPerspective;
}): Promise<{
  sections: { title: string; brief: string }[];
  motifs: StoryImage[];
  beds: StorySound[];
}> {
  const reply = await complete({
    model: args.model,
    apiKey: args.apiKey,
    system: STORY_OUTLINE_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: buildOutlinePrompt({
          topic: args.topic,
          style: args.style,
          minutes: args.minutes,
          sections: args.sections,
          motifs: args.motifs,
          beds: args.beds,
          known: args.known,
          research: args.research,
          perspective: args.perspective,
        }),
      },
    ],
    maxTokens: 6000,
    effort: "medium",
  });
  args.spent.input += reply.usage.input;
  args.spent.output += reply.usage.output;

  const json = parseJsonObject(reply.text) as {
    sections?: unknown;
    motifs?: unknown;
    beds?: unknown;
  };

  const sections = (Array.isArray(json.sections) ? json.sections : [])
    .map((item) => item as { title?: unknown; brief?: unknown })
    .filter((s) => typeof s.brief === "string" && s.brief.trim().length > 3)
    .map((s) => ({
      title: typeof s.title === "string" ? s.title.trim().slice(0, 90) : "",
      brief: (s.brief as string).trim().slice(0, 400),
    }));

  if (sections.length === 0) {
    throw new Error("Das Modell hat keine brauchbare Gliederung geliefert.");
  }

  const motifs: StoryImage[] = [];
  const seen = new Set<string>();
  for (const item of Array.isArray(json.motifs) ? json.motifs : []) {
    const m = item as { key?: unknown; name?: unknown; prompt?: unknown };
    const name = typeof m.name === "string" ? m.name.trim() : "";
    const prompt = typeof m.prompt === "string" ? m.prompt.trim() : "";
    if (prompt.length < 10) continue;
    const key = slugify(typeof m.key === "string" && m.key ? m.key : name);
    if (seen.has(key)) continue;
    seen.add(key);
    motifs.push({
      key,
      name: name.slice(0, 120) || key,
      prompt: prompt.slice(0, 700),
    });
  }

  const beds: StorySound[] = [];
  const heard = new Set<string>();
  for (const item of Array.isArray(json.beds) ? json.beds : []) {
    const b = item as { key?: unknown; name?: unknown; prompt?: unknown };
    const name = typeof b.name === "string" ? b.name.trim() : "";
    const prompt = typeof b.prompt === "string" ? b.prompt.trim() : "";
    if (prompt.length < 6) continue;
    const key = slugify(typeof b.key === "string" && b.key ? b.key : name);
    if (heard.has(key)) continue;
    heard.add(key);
    beds.push({
      key,
      name: name.slice(0, 120) || key,
      prompt: trimSoundPrompt(prompt, SOUND_PROMPT_LIMIT),
      kind: "ambience",
      // Ten seconds, looped. Long enough not to hear the seam, short enough
      // that a bed costs a twentieth of what generating it in full would.
      seconds: 10,
    });
  }

  return { sections, motifs, beds };
}

/**
 * Turn the model's two lists into a project that cannot render broken.
 *
 * The failure this guards against is specific and common: a shot naming an
 * image key that is not in the image list. Remotion would render a hole where
 * the picture should be, and nothing before the finished file would say so.
 * A shot pointing nowhere is therefore repaired — pointed at the previous
 * picture — rather than dropped, because dropping it would silently delete a
 * sentence from the narration.
 */
function reconcile(
  rawImages: unknown,
  rawShots: unknown,
  /** Pictures defined for the whole film that a shot may name. */
  motifs: StoryImage[] = [],
  rawAccents: unknown = [],
  /** Beds defined for the whole film that a shot may name. */
  beds: StorySound[] = [],
  /** Figures a picture may name. Anything else is dropped. */
  characters: StoryCharacter[] = [],
): { images: StoryImage[]; sounds: StorySound[]; shots: StoryShot[] } {
  const cast = new Set(characters.map((c) => c.key));
  const images = new Map<string, StoryImage>();
  for (const item of Array.isArray(rawImages) ? rawImages : []) {
    const i = item as {
      key?: unknown;
      name?: unknown;
      prompt?: unknown;
      characters?: unknown;
    };
    const name = typeof i.name === "string" ? i.name.trim() : "";
    const prompt = typeof i.prompt === "string" ? i.prompt.trim() : "";
    if (prompt.length < 10) continue;
    const key = slugify(typeof i.key === "string" && i.key ? i.key : name);
    if (images.has(key)) continue;

    // A figure the film does not have is dropped rather than carried: it would
    // append nothing to the image prompt and make the picture's fingerprint
    // depend on a name that means nothing.
    const inShot = (Array.isArray(i.characters) ? i.characters : [])
      .filter((c): c is string => typeof c === "string")
      .map((c) => slugify(c))
      .filter((c) => cast.has(c));

    images.set(key, {
      key,
      name: name.slice(0, 120) || key,
      prompt: prompt.slice(0, 700),
      ...(inShot.length ? { characters: [...new Set(inShot)] } : {}),
    });
  }
  // The shared motifs count as known keys without being re-declared here —
  // the section was told not to list them again, and a shot pointing at one
  // must not be treated as pointing at nothing.
  const known = new Set([...images.keys(), ...motifs.map((m) => m.key)]);
  if (known.size === 0) {
    throw new Error(
      "Das Modell hat keine brauchbaren Bildbeschreibungen geliefert.",
    );
  }

  // The section's own one-shot sounds. Beds come from the outline and are
  // known everywhere; accents are invented here, alongside the shot that
  // fires them.
  const sounds = new Map<string, StorySound>();
  for (const item of Array.isArray(rawAccents) ? rawAccents : []) {
    const a = item as {
      key?: unknown;
      name?: unknown;
      prompt?: unknown;
      seconds?: unknown;
    };
    const name = typeof a.name === "string" ? a.name.trim() : "";
    const prompt = typeof a.prompt === "string" ? a.prompt.trim() : "";
    if (prompt.length < 6) continue;
    const key = slugify(typeof a.key === "string" && a.key ? a.key : name);
    if (sounds.has(key)) continue;
    sounds.set(key, {
      key,
      name: name.slice(0, 120) || key,
      prompt: trimSoundPrompt(prompt, SOUND_PROMPT_LIMIT),
      kind: "accent",
      seconds: Math.min(4, Math.max(1, Number(a.seconds) || 2)),
    });
  }
  const bedKeys = new Set(beds.map((b) => b.key));

  const keys = [...known];
  const shots: StoryShot[] = [];
  let previous = keys[0];

  for (const item of Array.isArray(rawShots) ? rawShots : []) {
    const s = item as {
      text?: unknown;
      image?: unknown;
      motion?: unknown;
      ambience?: unknown;
      accent?: unknown;
    };
    const text = typeof s.text === "string" ? s.text.trim() : "";
    if (!text) continue;

    const wanted = typeof s.image === "string" ? slugify(s.image) : "";
    const image = known.has(wanted) ? wanted : previous;
    const held = shots.length > 0 && image === previous;
    previous = image;

    // A run of shots on one picture is ONE take with one continuous move, and
    // only the first shot's motion is consulted. Inheriting it here rather
    // than rotating on means the studio's scene list shows what will actually
    // happen instead of a direction that is quietly discarded.
    const motion = held
      ? shots[shots.length - 1].motion
      : typeof s.motion === "string" &&
          ["in", "out", "left", "right", "up", "down"].includes(s.motion)
        ? (s.motion as StoryShot["motion"])
        : MOTIONS[shots.length % MOTIONS.length];

    // A bed the outline never defined is dropped rather than carried: it
    // would name a sound nobody generates and play silence, which is the same
    // as none but costs a field of confusion.
    const wantedBed = typeof s.ambience === "string" ? slugify(s.ambience) : "";
    const ambience = bedKeys.has(wantedBed) ? wantedBed : undefined;

    const wantedAccent = typeof s.accent === "string" ? slugify(s.accent) : "";
    const accent = sounds.has(wantedAccent) ? wantedAccent : undefined;

    shots.push({
      id: `s${shots.length + 1}`,
      text: text.slice(0, 400),
      image,
      motion,
      ambience,
      accent,
    });
  }

  if (shots.length === 0) {
    throw new Error("Das Modell hat keinen gesprochenen Text geliefert.");
  }

  // A picture nobody shows is a picture nobody should pay for. Motifs are
  // filtered at the end of writeScript(), across all sections.
  const used = new Set(shots.map((s) => s.image));
  const fired = new Set(shots.map((s) => s.accent).filter(Boolean));
  return {
    images: [...images.values()].filter((i) => used.has(i.key)),
    sounds: [...sounds.values()].filter((s) => fired.has(s.key)),
    shots,
  };
}

/** Fallback rotation, so a model that forgets `motion` still gets variety. */
const MOTIONS: StoryShot["motion"][] = [
  "in",
  "left",
  "out",
  "right",
  "in",
  "up",
];

/**
 * Ein fertiges Skript übernehmen und nur bebildern.
 *
 * Dieselbe Zusage wie beim Finanz-Format und aus demselben Grund: zerlegt wird
 * im Code, zugeordnet vom Modell, und der gesprochene Text stammt Zeichen für
 * Zeichen aus dem, was eingefügt wurde. Siehe lib/script-import.ts.
 *
 * Ein Unterschied zum Finanz-Format, und er ist beruhigend: hier kostet das
 * Übernehmen nichts außer diesem einen Modellaufruf. Die Bilder werden danach
 * in einem eigenen Schritt gezeichnet, mit dem Preis daneben und auf
 * Knopfdruck — ein eingefügtes Skript kann also keine Zeichenrechnung
 * auslösen, die niemand bestellt hat.
 */
export async function importStoryScript(args: {
  jobId: string;
  script: string;
  /** Ein gespeicherter Look. Ohne ihn wird einer aus dem Skript geschrieben. */
  style?: StoryStyle;
  styleWish?: string;
  /** Figuren, die vorkommen dürfen. Werden in den Look übersetzt. */
  characters?: CharacterSeed[];
  /** Wieviele verschiedene Bilder höchstens. Aus der Rate im Studio. */
  imagesPerMinute?: number;
  apiKey: string;
  model?: TextModel;
  startedAt: number;
}): Promise<void> {
  const model = args.model ?? resolveTextModel(DEFAULT_STORY_MODEL);
  const spent = { input: 0, output: 0 };
  const topic = args.script.trim().slice(0, 120);

  const progress = (step: string) =>
    writeJson(storyJobPath(args.jobId), {
      jobId: args.jobId,
      topic,
      status: "running",
      step,
      startedAt: args.startedAt,
      updatedAt: Date.now(),
    } satisfies StoryJob);

  try {
    await progress("Skript wird zerlegt");
    const sentences = splitScript(args.script);
    if (sentences.length < 2) {
      throw new Error(
        "Aus diesem Text ließen sich keine Sätze lesen. Er braucht mindestens zwei.",
      );
    }
    if (!textIsUnchanged(args.script, sentences)) {
      throw new Error(
        "Beim Zerlegen ging Text verloren. Das Video wurde nicht erzeugt.",
      );
    }

    // Der Stil kommt aus dem Anfang des Skripts, wenn keiner mitgegeben wurde:
    // das ist das Thema, nur nicht als Stichwort formuliert.
    let style = args.style;
    let title = sentences[0].slice(0, 80);
    let cast: StoryCharacter[] = [];
    const seeds = (args.characters ?? []).filter(
      (c) => c.description.trim().length >= 3,
    );

    if (style) {
      // Ein gemerkter Look weiß nichts von Figuren, die nie in ihm vorkamen —
      // die müssen einzeln übersetzt werden. Wie in generateStory().
      if (seeds.length) {
        await progress("Figuren werden übersetzt");
        cast = await describeCharacters({
          model,
          apiKey: args.apiKey,
          spent,
          topic: sentences.slice(0, 6).join(" ").slice(0, 900),
          style,
          characters: seeds,
        });
      }
    } else {
      await progress("Bildstil wird festgelegt");
      const written = await writeStyle({
        model,
        apiKey: args.apiKey,
        spent,
        topic: sentences.slice(0, 6).join(" ").slice(0, 900),
        wish: args.styleWish,
        characters: seeds,
      });
      style = written.style;
      title = written.title;
      cast = written.characters;
    }

    await progress("Bilder werden zugeordnet");
    const minutes = Math.max(1, sentences.length / (WORDS_PER_MINUTE / 10));
    const imageBudget = Math.max(
      3,
      Math.min(400, Math.round(minutes * (args.imagesPerMinute ?? 4))),
    );

    const reply = await complete({
      model,
      apiKey: args.apiKey,
      system: STORY_IMPORT_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: buildStoryImportPrompt({
            sentences,
            style,
            imageBudget,
            characters: cast,
          }),
        },
      ],
      maxTokens: 16000,
      effort: "medium",
    });
    spent.input += reply.usage.input;
    spent.output += reply.usage.output;

    const json = parseJsonObject(reply.text) as {
      title?: unknown;
      images?: unknown;
      spans?: unknown;
    };

    const assembled = assignImages(sentences, json.images, json.spans, cast);

    const project = StoryProject.parse({
      kind: "video",
      id: `story-${args.jobId}`,
      topic,
      title:
        typeof json.title === "string" && json.title.trim().length > 2
          ? json.title.trim().slice(0, 120)
          : title,
      style,
      characters: cast,
      imagesPerMinute: args.imagesPerMinute,
      images: assembled.images,
      shots: assembled.shots,
      fps: 30,
      width: 1920,
      height: 1080,
    });

    await writeJson(storyJobPath(args.jobId), {
      jobId: args.jobId,
      topic,
      status: "done",
      project,
      warning: assembled.warning,
      cost: {
        model: model.id,
        label: model.label,
        inputTokens: spent.input,
        outputTokens: spent.output,
        cents: Number(costCents(model, spent).toFixed(3)),
      },
      startedAt: args.startedAt,
      updatedAt: Date.now(),
    } satisfies StoryJob);
  } catch (err) {
    await writeJson(storyJobPath(args.jobId), {
      jobId: args.jobId,
      topic,
      status: "error",
      error: (err as Error).message.slice(0, 400),
      startedAt: args.startedAt,
      updatedAt: Date.now(),
    } satisfies StoryJob).catch(() => undefined);
  }
}

/**
 * Die Zuordnung des Modells auf die Sätze legen.
 *
 * Wie assignScenes() im Finanz-Format: die Sätze stehen fest, was das Modell
 * liefert, wird zurechtgerückt statt abgelehnt. Ein Satz ohne Bild bekommt
 * das Bild davor — eine Lücke darf kein Video kosten, dessen Text schon
 * feststeht.
 */
export function assignImages(
  sentences: string[],
  rawImages: unknown,
  rawSpans: unknown,
  cast: StoryCharacter[] = [],
): { images: StoryImage[]; shots: StoryShot[]; warning?: string } {
  const castKeys = new Set(cast.map((c) => c.key));
  const images: StoryImage[] = [];
  let dropped = 0;

  for (const raw of Array.isArray(rawImages) ? rawImages : []) {
    const candidate = raw as {
      key?: unknown;
      name?: unknown;
      prompt?: unknown;
      characters?: unknown;
    };
    const name =
      typeof candidate.name === "string" ? candidate.name.trim() : "";
    const prompt =
      typeof candidate.prompt === "string" ? candidate.prompt.trim() : "";
    const key = slugify(
      typeof candidate.key === "string" && candidate.key ? candidate.key : name,
    );
    if (!key || name.length < 3 || prompt.length < 10) {
      dropped += 1;
      continue;
    }
    if (images.some((i) => i.key === key)) continue;
    // Nur Figuren, die es wirklich gibt: ein erfundener Schlüssel würde beim
    // Zeichnen still nichts anhängen und die Figur wäre nicht im Bild.
    const figures = (
      Array.isArray(candidate.characters) ? candidate.characters : []
    )
      .map((c) => slugify(typeof c === "string" ? c : ""))
      .filter((c) => castKeys.has(c));

    images.push({
      key,
      name: name.slice(0, 120),
      prompt: prompt.slice(0, 700),
      ...(figures.length ? { characters: figures } : {}),
    });
  }

  if (!images.length) {
    throw new Error("Das Modell hat kein brauchbares Bild geliefert.");
  }

  const keys = new Set(images.map((i) => i.key));
  const perSentence = new Array<string | undefined>(sentences.length);
  const motion = new Array<ShotMotion | undefined>(sentences.length);

  for (const raw of Array.isArray(rawSpans) ? rawSpans : []) {
    const span = raw as {
      from?: unknown;
      to?: unknown;
      image?: unknown;
      motion?: unknown;
    };
    const key = slugify(typeof span.image === "string" ? span.image : "");
    if (!keys.has(key)) continue;
    const from = Math.max(0, Math.round(Number(span.from)));
    const to = Math.min(sentences.length - 1, Math.round(Number(span.to)));
    if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) continue;
    const move = ShotMotion.safeParse(span.motion).data ?? "in";
    for (let i = from; i <= to; i += 1) {
      perSentence[i] ??= key;
      motion[i] ??= move;
    }
  }

  let last: string | undefined;
  let lastMove: ShotMotion | undefined;
  for (let i = 0; i < perSentence.length; i += 1) {
    if (perSentence[i]) {
      last = perSentence[i];
      lastMove = motion[i];
    } else {
      perSentence[i] = last;
      motion[i] = lastMove;
    }
  }
  const first = perSentence.find(Boolean) ?? images[0].key;
  const gaps = perSentence.filter((k) => k === undefined).length;
  for (let i = 0; i < perSentence.length; i += 1) perSentence[i] ??= first;

  const shots: StoryShot[] = sentences.map((text, i) => ({
    id: `s${i + 1}`,
    text,
    image: perSentence[i]!,
    motion: motion[i] ?? "in",
  }));

  const used = new Set(shots.map((s) => s.image));
  return {
    images: images.filter((i) => used.has(i.key)),
    shots,
    warning:
      dropped > 0
        ? `${dropped} ${dropped === 1 ? "Bild wurde" : "Bilder wurden"} verworfen, weil die Beschreibung fehlte. Die betroffenen Sätze zeigen das Bild davor. Der gesprochene Text ist unverändert.`
        : gaps > 0
          ? "Für einen Teil der Sätze hat das Modell kein Bild zugeordnet — dort bleibt das vorige stehen. Der gesprochene Text ist unverändert."
          : undefined,
  };
}
