import { complete } from "./llm";
import { slugify } from "./image-library";
import { StoryProject, StoryStyle, type StoryImage, type StoryShot } from "./story";
import {
  buildScriptPrompt,
  buildStylePrompt,
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

    await progress(`${Math.round(args.minutes * WORDS_PER_MINUTE)} Wörter werden geschrieben`);
    const script = await writeScript({
      model,
      apiKey: args.apiKey,
      spent,
      topic: args.topic,
      style: style.style,
      minutes: args.minutes,
      imageBudget: args.imageBudget,
    });

    const project = StoryProject.parse({
      kind: "video",
      id: `story-${args.jobId}`,
      topic: args.topic,
      title: style.title,
      style: style.style,
      images: script.images,
      shots: script.shots,
      fps: 30,
      width: 1920,
      height: 1080,
    });

    await writeJson(storyJobPath(args.jobId), {
      jobId: args.jobId,
      topic: args.topic,
      status: "done",
      project,
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

async function writeScript(args: {
  model: TextModel;
  apiKey: string;
  spent: { input: number; output: number };
  topic: string;
  style: StoryStyle;
  minutes: number;
  imageBudget: number;
}): Promise<{ images: StoryImage[]; shots: StoryShot[] }> {
  const reply = await complete({
    model: args.model,
    apiKey: args.apiKey,
    system: STORY_SCRIPT_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: buildScriptPrompt({
          topic: args.topic,
          style: args.style,
          minutes: args.minutes,
          imageBudget: args.imageBudget,
        }),
      },
    ],
    // Scaled with the length, and generously: thinking counts against this on
    // both providers, and a reply cut off at the ceiling loses the whole
    // script rather than its tail.
    maxTokens: Math.min(32000, 8000 + Math.round(args.minutes * 3200)),
    effort: "medium",
  });
  args.spent.input += reply.usage.input;
  args.spent.output += reply.usage.output;

  if (reply.truncated) {
    throw new Error(
      "Das Skript wurde beim Token-Limit abgeschnitten. Wähle eine kürzere Länge und setz das Video aus zwei Teilen zusammen.",
    );
  }

  const json = parseObject(reply.text) as { images?: unknown; shots?: unknown };
  return reconcile(json.images, json.shots);
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
): { images: StoryImage[]; shots: StoryShot[] } {
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
  if (images.size === 0) {
    throw new Error("Das Modell hat keine brauchbaren Bildbeschreibungen geliefert.");
  }

  const keys = [...images.keys()];
  const shots: StoryShot[] = [];
  let previous = keys[0];

  for (const item of Array.isArray(rawShots) ? rawShots : []) {
    const s = item as { text?: unknown; image?: unknown; motion?: unknown };
    const text = typeof s.text === "string" ? s.text.trim() : "";
    if (!text) continue;

    const wanted = typeof s.image === "string" ? slugify(s.image) : "";
    const image = images.has(wanted) ? wanted : previous;
    previous = image;

    const motion =
      typeof s.motion === "string" &&
      ["in", "out", "left", "right", "up", "down"].includes(s.motion)
        ? (s.motion as StoryShot["motion"])
        : MOTIONS[shots.length % MOTIONS.length];

    shots.push({
      id: `s${shots.length + 1}`,
      text: text.slice(0, 400),
      image,
      motion,
    });
  }

  if (shots.length === 0) {
    throw new Error("Das Modell hat keinen gesprochenen Text geliefert.");
  }

  // A picture nobody shows is a picture nobody should pay for.
  const used = new Set(shots.map((s) => s.image));
  return {
    images: [...images.values()].filter((i) => used.has(i.key)),
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
