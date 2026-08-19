import { complete } from "./llm";
import { slugify } from "./image-library";
import {
  StoryProject,
  StoryStyle,
  type StoryImage,
  type StoryShot,
  type StorySound,
} from "./story";
import {
  buildOutlinePrompt,
  buildSectionPrompt,
  buildStylePrompt,
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
    await progress("Bildstil wird festgelegt");
    const style = await writeStyle({
      model,
      apiKey: args.apiKey,
      spent,
      topic: args.topic,
    });

    const script = await writeScript({
      model,
      apiKey: args.apiKey,
      spent,
      topic: args.topic,
      style: style.style,
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
      warning: script.short
        ? `Nicht alle Abschnitte wurden fertig — das Video ist ${Math.round(words / WORDS_PER_MINUTE)} statt ${args.minutes} Minuten lang. Erzeug es noch einmal, oder nimm eine kürzere Länge.`
        : undefined,
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

async function writeStyle(args: {
  model: TextModel;
  apiKey: string;
  spent: { input: number; output: number };
  topic: string;
}): Promise<{ title: string; style: StoryStyle }> {
  const reply = await complete({
    model: args.model,
    apiKey: args.apiKey,
    system: STORY_STYLE_SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildStylePrompt(args.topic) }],
    maxTokens: 4000,
    effort: "medium",
  });
  args.spent.input += reply.usage.input;
  args.spent.output += reply.usage.output;

  const json = parseObject(reply.text) as {
    title?: unknown;
    styleName?: unknown;
    directive?: unknown;
    palette?: unknown;
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
  };
}

/**
 * When to stop starting new sections.
 *
 * The route is allowed 300 seconds. A section that begins at 250 will not
 * finish, and a job killed mid-write leaves nothing at all — whereas stopping
 * early leaves a shorter film that is complete as far as it goes.
 */
const WRITING_DEADLINE_MS = 250_000;

/** Minutes of video per section. Small enough that a model actually fills it. */
const MINUTES_PER_SECTION = 2;

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
  minutes: number;
  imageBudget: number;
  deadline: number;
  onProgress: (step: string) => Promise<unknown>;
}): Promise<{
  images: StoryImage[];
  sounds: StorySound[];
  shots: StoryShot[];
  short: boolean;
}> {
  const sectionCount = Math.max(
    1,
    Math.min(15, Math.round(args.minutes / MINUTES_PER_SECTION)),
  );

  // A third of the picture budget goes to motifs that every section may draw
  // on; the rest is split between them. Without a shared pool the sections
  // would each invent their own vocabulary and nothing would ever recur.
  const motifBudget = Math.max(3, Math.min(8, Math.round(args.imageBudget / 3)));
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
              motifs: plan.motifs,
              beds: plan.beds,
              imageBudget: perSection,
            }),
          },
        ],
        maxTokens: 16000,
        effort: "medium",
      });
      args.spent.input += reply.usage.input;
      args.spent.output += reply.usage.output;

      try {
        const json = parseObject(reply.text) as {
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

  await Promise.all(Array.from({ length: Math.min(LANES, sectionCount) }, lane));

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
  return {
    images: [...images.values()].filter((i) => used.has(i.key)),
    sounds: [...sounds.values()].filter((s) => heard.has(s.key)),
    shots,
    short,
  };
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
        }),
      },
    ],
    maxTokens: 6000,
    effort: "medium",
  });
  args.spent.input += reply.usage.input;
  args.spent.output += reply.usage.output;

  const json = parseObject(reply.text) as {
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
    motifs.push({ key, name: name.slice(0, 120) || key, prompt: prompt.slice(0, 700) });
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
      prompt: prompt.slice(0, 400),
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
): { images: StoryImage[]; sounds: StorySound[]; shots: StoryShot[] } {
  const images = new Map<string, StoryImage>();
  for (const item of Array.isArray(rawImages) ? rawImages : []) {
    const i = item as { key?: unknown; name?: unknown; prompt?: unknown };
    const name = typeof i.name === "string" ? i.name.trim() : "";
    const prompt = typeof i.prompt === "string" ? i.prompt.trim() : "";
    if (prompt.length < 10) continue;
    const key = slugify(typeof i.key === "string" && i.key ? i.key : name);
    if (images.has(key)) continue;
    images.set(key, {
      key,
      name: name.slice(0, 120) || key,
      prompt: prompt.slice(0, 700),
    });
  }
  // The shared motifs count as known keys without being re-declared here —
  // the section was told not to list them again, and a shot pointing at one
  // must not be treated as pointing at nothing.
  const known = new Set([...images.keys(), ...motifs.map((m) => m.key)]);
  if (known.size === 0) {
    throw new Error("Das Modell hat keine brauchbaren Bildbeschreibungen geliefert.");
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
      prompt: prompt.slice(0, 400),
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
    previous = image;

    const motion =
      typeof s.motion === "string" &&
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
const MOTIONS: StoryShot["motion"][] = ["in", "left", "out", "right", "in", "up"];

function parseObject(raw: string): Record<string, unknown> {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error("Die Antwort enthielt kein JSON-Objekt.");
  }
  try {
    return JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    throw new Error("Die Antwort war kein gültiges JSON.");
  }
}
