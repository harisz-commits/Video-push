import { complete } from "./llm";
import { slugify } from "./image-library";
import { FinanceScene } from "./finance";
import {
  buildFinanceOutlinePrompt,
  buildFinanceSectionPrompt,
  FINANCE_OUTLINE_SYSTEM_PROMPT,
  FINANCE_SCRIPT_SYSTEM_PROMPT,
  WORDS_PER_MINUTE,
} from "./finance-prompt";
import { soundLibrary, type KnownSound } from "./sfx";
import { StoryProject, type StoryShot, type StorySound } from "./story";
import { researchTopic } from "./story-research";
import { costCents, resolveTextModel, type TextModel } from "./text-models";
import { storyJobPath, writeJson, type StoryJob } from "./store";

/**
 * Ein Finanzvideo schreiben.
 *
 * Derselbe Ablauf wie beim Video-Format — Recherche, Gliederung, Abschnitte
 * nebeneinander — und zwei Schritte weniger: es gibt keinen Bildstil und
 * keine Figurenübersetzung, weil nichts gezeichnet wird. Dafür ist die
 * Prüfung strenger: eine Szene, die das Schema nicht besteht, ist keine
 * halb brauchbare Grafik, sondern gar keine, und die Sätze, die auf ihr
 * stehen sollten, müssen woanders hin.
 *
 * Eine eigene Datei statt eines Schalters in story-pipeline.ts, weil dort der
 * halbe Umfang aus Bildern besteht — Motive verteilen, Wiederholungen
 * aufbrechen, Bildbudget rechnen — und all das hier bedeutungslos ist. Eine
 * Szene kostet nichts, also gibt es kein Budget, und eine Szene, die dreimal
 * kommt, ist kein Fehler, sondern ein Diagramm, auf das zurückgekommen wird.
 */

export const DEFAULT_FINANCE_MODEL = "gemini-3.7-flash";

const RESEARCH_DEADLINE_MS = 80_000;
const WRITING_DEADLINE_MS = 250_000;
const MINUTES_PER_SECTION = 2;
const LANES = 3;

export async function generateFinance(args: {
  jobId: string;
  topic: string;
  minutes: number;
  research?: boolean;
  apiKey: string;
  model?: TextModel;
  startedAt: number;
}): Promise<void> {
  const model = args.model ?? resolveTextModel(DEFAULT_FINANCE_MODEL);
  const spent = { input: 0, output: 0 };

  const progress = (step: string) =>
    writeJson(storyJobPath(args.jobId), {
      jobId: args.jobId,
      topic: args.topic,
      status: "running",
      step,
      startedAt: args.startedAt,
      updatedAt: Date.now(),
    } satisfies StoryJob);

  try {
    /**
     * Die Recherche ist hier wichtiger als beim Video-Format.
     *
     * Dort ist eine falsche Jahreszahl peinlich. Hier steht die Zahl groß im
     * Bild, mit einer Quellenzeile darunter, und eine falsche Rendite mit
     * einer Quelle darunter ist schlimmer als eine ohne.
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
      }).catch(() => null);
      if (found) {
        research = found.facts;
        searches = found.searches;
        spent.input += found.usage.input;
        spent.output += found.usage.output;
      }
    }

    const script = await writeScript({
      model,
      apiKey: args.apiKey,
      spent,
      topic: args.topic,
      research,
      minutes: args.minutes,
      deadline: args.startedAt + WRITING_DEADLINE_MS,
      onProgress: progress,
    });

    const project = StoryProject.parse({
      kind: "finanz",
      id: `finance-${args.jobId}`,
      topic: args.topic,
      title: script.title,
      // Nicht benutzt, aber vom Schema verlangt: die Kanal-Identität steht in
      // remotion/shared/Tokens.ts und nicht in den Projektdaten, weil sie für
      // jedes Finanzvideo dieselbe ist.
      style: {
        name: "Kanal-Identität",
        directive:
          "Not used by this format — finance scenes are drawn in code from the shared design tokens rather than generated from a prompt.",
        palette: ["#0E1A2B", "#E3B23C", "#4FB99F", "#C4452F"],
      },
      research: research || undefined,
      scenes: script.scenes,
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
      warning: buildWarning({
        short: script.short,
        dropped: script.dropped,
        words,
        minutes: args.minutes,
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

async function writeScript(args: {
  model: TextModel;
  apiKey: string;
  spent: { input: number; output: number };
  topic: string;
  research: string;
  minutes: number;
  deadline: number;
  onProgress: (step: string) => Promise<unknown>;
}): Promise<{
  title: string;
  scenes: FinanceScene[];
  sounds: StorySound[];
  shots: StoryShot[];
  short: boolean;
  /** Szenen, die das Schema nicht bestanden haben. */
  dropped: number;
}> {
  const sectionCount = Math.max(
    1,
    Math.min(15, Math.round(args.minutes / MINUTES_PER_SECTION)),
  );
  const known = await soundLibrary().catch(() => ({
    beds: [] as KnownSound[],
    accents: [] as KnownSound[],
  }));
  const bedBudget = args.minutes >= 8 ? 4 : 2;

  await args.onProgress(
    sectionCount === 1
      ? "Skript wird geschrieben"
      : `Gliederung für ${sectionCount} Abschnitte`,
  );

  const plan = await writeOutline({
    model: args.model,
    apiKey: args.apiKey,
    spent: args.spent,
    topic: args.topic,
    minutes: args.minutes,
    sections: sectionCount,
    beds: bedBudget,
    known: known.beds,
    research: args.research,
  });

  const words = Math.round((args.minutes * WORDS_PER_MINUTE) / sectionCount);
  const results = new Array<{
    scenes: FinanceScene[];
    sounds: StorySound[];
    shots: StoryShot[];
    dropped: number;
  } | null>(sectionCount).fill(null);

  let next = 0;
  let done = 0;
  let short = false;

  const lane = async () => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= sectionCount) return;
      if (Date.now() > args.deadline) {
        short = true;
        return;
      }

      const reply = await complete({
        model: args.model,
        apiKey: args.apiKey,
        system: FINANCE_SCRIPT_SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: buildFinanceSectionPrompt({
              topic: args.topic,
              sections: plan.sections,
              index,
              words,
              beds: plan.beds,
              knownAccents: known.accents,
              research: args.research,
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
          scenes?: unknown;
          accents?: unknown;
          shots?: unknown;
        };
        results[index] = reconcile(json.scenes, json.shots, json.accents, plan.beds);
      } catch {
        // Ein Abschnitt, der nicht lesbar ist, darf die anderen nicht kosten.
        short = true;
      }

      done += 1;
      await args.onProgress(`Abschnitt ${done} von ${sectionCount}`);
    }
  };

  await Promise.all(Array.from({ length: Math.min(LANES, sectionCount) }, lane));

  const scenes = new Map<string, FinanceScene>();
  const sounds = new Map<string, StorySound>();
  for (const bed of plan.beds) sounds.set(bed.key, bed);
  const shots: StoryShot[] = [];
  let dropped = 0;

  for (const result of results) {
    if (!result) continue;
    dropped += result.dropped;
    for (const scene of result.scenes) {
      if (!scenes.has(scene.key)) scenes.set(scene.key, scene);
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

  const used = new Set(shots.map((s) => s.image));
  const heard = new Set(
    shots.flatMap((s) => [s.ambience, s.accent].filter(Boolean) as string[]),
  );

  return {
    title: plan.title,
    scenes: [...scenes.values()].filter((s) => used.has(s.key)),
    sounds: [...sounds.values()].filter((s) => heard.has(s.key)),
    shots,
    short,
    dropped,
  };
}

async function writeOutline(args: {
  model: TextModel;
  apiKey: string;
  spent: { input: number; output: number };
  topic: string;
  minutes: number;
  sections: number;
  beds: number;
  known?: KnownSound[];
  research?: string;
}): Promise<{
  title: string;
  sections: { title: string; brief: string }[];
  beds: StorySound[];
}> {
  const reply = await complete({
    model: args.model,
    apiKey: args.apiKey,
    system: FINANCE_OUTLINE_SYSTEM_PROMPT,
    messages: [
      { role: "user", content: buildFinanceOutlinePrompt(args) },
    ],
    maxTokens: 6000,
    effort: "medium",
  });
  args.spent.input += reply.usage.input;
  args.spent.output += reply.usage.output;

  const json = parseObject(reply.text) as {
    title?: unknown;
    sections?: unknown;
    beds?: unknown;
  };

  const sections = (Array.isArray(json.sections) ? json.sections : [])
    .map((raw) => {
      const s = raw as { title?: unknown; brief?: unknown };
      return {
        title: typeof s.title === "string" ? s.title.trim().slice(0, 120) : "",
        brief: typeof s.brief === "string" ? s.brief.trim().slice(0, 600) : "",
      };
    })
    .filter((s) => s.title.length > 1)
    .slice(0, args.sections);

  if (!sections.length) {
    throw new Error("Das Modell hat keine Gliederung geliefert.");
  }

  const beds: StorySound[] = [];
  for (const raw of Array.isArray(json.beds) ? json.beds : []) {
    const b = raw as {
      key?: unknown;
      name?: unknown;
      prompt?: unknown;
      seconds?: unknown;
    };
    const name = typeof b.name === "string" ? b.name.trim() : "";
    const prompt = typeof b.prompt === "string" ? b.prompt.trim() : "";
    if (name.length < 3 || prompt.length < 6) continue;
    const key = slugify(typeof b.key === "string" && b.key ? b.key : name);
    if (!key || beds.some((existing) => existing.key === key)) continue;
    beds.push({
      key,
      name: name.slice(0, 120),
      prompt: prompt.slice(0, 400),
      kind: "ambience",
      seconds: Math.min(20, Math.max(8, Math.round(Number(b.seconds) || 12))),
    });
  }

  return {
    title:
      typeof json.title === "string" && json.title.trim().length > 2
        ? json.title.trim().slice(0, 120)
        : args.topic.slice(0, 60),
    sections,
    beds: beds.slice(0, args.beds),
  };
}

/**
 * Die Antwort eines Abschnitts, auf das reduziert, was sich rendern lässt.
 *
 * Der Unterschied zum Video-Format: dort ist eine schlecht beschriebene
 * Bildidee immer noch ein Bild. Hier ist eine Szene, der ein Pflichtfeld
 * fehlt, gar nichts — und ihre Sätze zeigten dann auf ein Loch. Also werden
 * die Sätze einer verworfenen Szene auf die vorige umgehängt, statt sie
 * mitzuverlieren: der Text bleibt vollständig, und auf dem Schirm steht die
 * Grafik davor eben ein paar Sekunden länger.
 */
export function reconcile(
  rawScenes: unknown,
  rawShots: unknown,
  rawAccents: unknown,
  beds: StorySound[],
): {
  scenes: FinanceScene[];
  sounds: StorySound[];
  shots: StoryShot[];
  dropped: number;
} {
  const scenes: FinanceScene[] = [];
  let dropped = 0;

  for (const raw of Array.isArray(rawScenes) ? rawScenes : []) {
    const candidate = raw as { key?: unknown; name?: unknown };
    // Der Schlüssel wird hier zurechtgebogen statt abgelehnt: ein Modell, das
    // "Zinseszins Kurve" schreibt, hat die Szene richtig gebaut und nur den
    // Slug nicht getroffen.
    const key = slugify(
      typeof candidate.key === "string" && candidate.key
        ? candidate.key
        : typeof candidate.name === "string"
          ? candidate.name
          : "",
    );
    const parsed = FinanceScene.safeParse({ ...(raw as object), key });
    if (!parsed.success) {
      dropped += 1;
      continue;
    }
    if (scenes.some((s) => s.key === parsed.data.key)) continue;
    scenes.push(parsed.data);
  }

  const accents: StorySound[] = [];
  for (const raw of Array.isArray(rawAccents) ? rawAccents : []) {
    const a = raw as {
      key?: unknown;
      name?: unknown;
      prompt?: unknown;
      seconds?: unknown;
    };
    const name = typeof a.name === "string" ? a.name.trim() : "";
    const prompt = typeof a.prompt === "string" ? a.prompt.trim() : "";
    if (name.length < 3 || prompt.length < 6) continue;
    const key = slugify(typeof a.key === "string" && a.key ? a.key : name);
    if (!key || accents.some((existing) => existing.key === key)) continue;
    accents.push({
      key,
      name: name.slice(0, 120),
      prompt: prompt.slice(0, 400),
      kind: "accent",
      seconds: Math.min(4, Math.max(1, Math.round(Number(a.seconds) || 2))),
    });
  }

  const bedKeys = new Set(beds.map((b) => b.key));
  const accentKeys = new Set(accents.map((a) => a.key));
  const sceneKeys = new Set(scenes.map((s) => s.key));

  const shots: StoryShot[] = [];
  let lastScene = scenes[0]?.key;

  for (const raw of Array.isArray(rawShots) ? rawShots : []) {
    const s = raw as {
      text?: unknown;
      scene?: unknown;
      image?: unknown;
      ambience?: unknown;
      accent?: unknown;
    };
    const text = typeof s.text === "string" ? s.text.trim() : "";
    if (text.length < 2) continue;

    // "scene" ist der Name im Prompt, "image" das Feld im Schema. Beides
    // angenommen, weil ein Modell auch das zweite trifft, wenn es das Beispiel
    // gesehen hat.
    const named = slugify(
      typeof s.scene === "string"
        ? s.scene
        : typeof s.image === "string"
          ? s.image
          : "",
    );
    const scene = named && sceneKeys.has(named) ? named : lastScene;
    if (!scene) continue;
    lastScene = scene;

    const ambience =
      typeof s.ambience === "string" && bedKeys.has(slugify(s.ambience))
        ? slugify(s.ambience)
        : undefined;
    const accent =
      typeof s.accent === "string" && accentKeys.has(slugify(s.accent))
        ? slugify(s.accent)
        : undefined;

    shots.push({
      id: "",
      text: text.slice(0, 400),
      image: scene,
      // Wird von dieser Komposition nicht benutzt — es gibt keine Kamerafahrt
      // über einem Diagramm. Das Feld ist im Schema Pflicht.
      motion: "in",
      ambience,
      accent,
    });
  }

  return { scenes, sounds: accents, shots, dropped };
}

function buildWarning(args: {
  short: boolean;
  dropped: number;
  words: number;
  minutes: number;
  researched: boolean;
  searches: number;
  facts: number;
}): string | undefined {
  const expected = args.minutes * WORDS_PER_MINUTE;
  if (args.short || args.words < expected * 0.7) {
    return `Das Video ist kürzer geworden als bestellt — ${args.words} statt rund ${expected} Wörter. Ein Abschnitt ging verloren.`;
  }
  if (args.dropped > 0) {
    return `${args.dropped} ${
      args.dropped === 1 ? "Szene wurde" : "Szenen wurden"
    } verworfen, weil Pflichtangaben fehlten — meistens die Quelle. Die Sätze dazu stehen jetzt auf der Szene davor.`;
  }
  if (args.researched && args.facts === 0) {
    return "Die Recherche hat nichts geliefert — das Skript ist aus dem Gedächtnis geschrieben. Bei Zahlen und Renditen ist das die unsicherste Grundlage.";
  }
  if (args.researched && args.searches === 0 && args.facts > 0) {
    return "Die Fakten kamen ohne eine einzige Websuche zustande. Sieh sie durch, bevor du das Video rendern lässt.";
  }
  return undefined;
}

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
