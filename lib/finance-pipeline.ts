import { parseJsonObject } from "./json";
import { complete } from "./llm";
import { slugify } from "./image-library";
import {
  countTextScenes,
  FinanceScene,
  TEXT_SCENE_SHARE,
  withDisclaimer,
  type FinanceFormat,
} from "./finance";
import {
  buildFinanceImportPrompt,
  buildFinanceOutlinePrompt,
  buildFinanceSectionPrompt,
  FINANCE_IMPORT_SYSTEM_PROMPT,
  type OpenLoop,
  FINANCE_OUTLINE_SYSTEM_PROMPT,
  FINANCE_SCRIPT_SYSTEM_PROMPT,
  WORDS_PER_MINUTE,
} from "./finance-prompt";
import {
  soundLibrary,
  SOUND_PROMPT_LIMIT,
  trimSoundPrompt,
  type KnownSound,
} from "./sfx";
import { StoryProject, type StoryShot, type StorySound } from "./story";
import { researchTopic } from "./story-research";
import { splitScript, textIsUnchanged } from "./script-import";
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
  /** Welche Sorte Finanzvideo. Siehe FINANCE_FORMATS. */
  format?: FinanceFormat;
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
      format: args.format ?? "fehler",
      minutes: args.minutes,
      deadline: args.startedAt + WRITING_DEADLINE_MS,
      onProgress: progress,
    });

    // Der Hinweis wird eingesetzt, nicht erbeten — und hier, VOR der Aufnahme,
    // damit er auch gesprochen wird. Siehe withDisclaimer().
    const withNote = withDisclaimer({
      scenes: script.scenes,
      shots: script.shots,
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
      // Leiser als beim Video-Format. Dort ist der Klang die Umgebung und darf
      // gehört werden; hier ist er Musik unter einer Erklärung, und Musik, die
      // man bemerkt, während jemand Zahlen nennt, ist zu laut.
      soundLevel: 0.1,
      scenes: withNote.scenes,
      sounds: script.sounds,
      shots: withNote.shots,
      fps: 30,
      width: 1920,
      height: 1080,
    });

    const words = withNote.shots.reduce(
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
        textScenes: countTextScenes(withNote.scenes),
        scenes: withNote.scenes.length,
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
  format: FinanceFormat;
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
  // Musik-Teppiche, nicht Umgebungsgeräusche. Siehe soundLibrary().
  const known = await soundLibrary({ music: true }).catch(() => ({
    beds: [] as KnownSound[],
    accents: [] as KnownSound[],
  }));
  // Einer, immer. Musik, die mittendrin wechselt, ist ein Ereignis, und der
  // Inhalt eines Erklärvideos gibt keins her.
  const bedBudget = 1;

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
    format: args.format,
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
              format: args.format,
              sections: plan.sections,
              loops: plan.loops,
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
        const json = parseJsonObject(reply.text) as {
          scenes?: unknown;
          accents?: unknown;
          shots?: unknown;
        };
        results[index] = reconcile(
          json.scenes,
          json.shots,
          json.accents,
          plan.beds,
        );
      } catch {
        // Ein Abschnitt, der nicht lesbar ist, darf die anderen nicht kosten.
        short = true;
      }

      done += 1;
      await args.onProgress(`Abschnitt ${done} von ${sectionCount}`);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(LANES, sectionCount) }, lane),
  );

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
  format: FinanceFormat;
  known?: KnownSound[];
  research?: string;
}): Promise<{
  title: string;
  sections: { title: string; brief: string }[];
  loops: OpenLoop[];
  beds: StorySound[];
}> {
  const reply = await complete({
    model: args.model,
    apiKey: args.apiKey,
    system: FINANCE_OUTLINE_SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildFinanceOutlinePrompt(args) }],
    maxTokens: 6000,
    effort: "medium",
  });
  args.spent.input += reply.usage.input;
  args.spent.output += reply.usage.output;

  const json = parseJsonObject(reply.text) as {
    title?: unknown;
    sections?: unknown;
    loops?: unknown;
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
      prompt: trimSoundPrompt(prompt, SOUND_PROMPT_LIMIT),
      kind: "ambience",
      seconds: Math.min(20, Math.max(8, Math.round(Number(b.seconds) || 12))),
    });
  }

  /**
   * Die offenen Fragen, auf das reduziert, was tatsächlich Spannung erzeugt.
   *
   * Eine Frage, die im selben Abschnitt aufgeworfen und beantwortet wird, ist
   * keine offene Frage — sie wäre eine Anweisung an das Modell, sich selbst
   * zu widersprechen. Und eine, die außerhalb der Gliederung zeigt, käme in
   * keinem Abschnitt an: aufgeworfen und nie beantwortet.
   */
  const loops: OpenLoop[] = [];
  for (const raw of Array.isArray(json.loops) ? json.loops : []) {
    const l = raw as { question?: unknown; raise?: unknown; answer?: unknown };
    const question = typeof l.question === "string" ? l.question.trim() : "";
    const from = Math.round(Number(l.raise));
    const to = Math.round(Number(l.answer));
    if (question.length < 8) continue;
    if (!Number.isFinite(from) || !Number.isFinite(to)) continue;
    if (from < 1 || to > sections.length || to <= from) continue;
    loops.push({ question: question.slice(0, 200), raise: from, answer: to });
  }

  return {
    title:
      typeof json.title === "string" && json.title.trim().length > 2
        ? json.title.trim().slice(0, 120)
        : args.topic.slice(0, 60),
    sections,
    loops: loops.slice(0, 3),
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
      prompt: trimSoundPrompt(prompt, SOUND_PROMPT_LIMIT),
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
  /** Szenen ohne Zahlen — aussage, vergleich, zeitstrahl. */
  textScenes: number;
  scenes: number;
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
  // Der Hinweis-Einschub ist eine Textszene und war nie gewollt — er zählt
  // deshalb nicht gegen die Quote.
  const text = Math.max(0, args.textScenes - 1);
  if (args.scenes > 3 && text > args.scenes * TEXT_SCENE_SHARE) {
    return `${text} von ${args.scenes} Szenen zeigen keine Zahlen, sondern nur Text. Das sieht nach Vortragsfolien aus — schreib das Skript noch einmal, dann sucht das Modell erneut nach Zahlen.`;
  }
  if (args.researched && args.facts === 0) {
    return "Die Recherche hat nichts geliefert — das Skript ist aus dem Gedächtnis geschrieben. Bei Zahlen und Renditen ist das die unsicherste Grundlage.";
  }
  if (args.researched && args.searches === 0 && args.facts > 0) {
    return "Die Fakten kamen ohne eine einzige Websuche zustande. Sieh sie durch, bevor du das Video rendern lässt.";
  }
  return undefined;
}

/**
 * Ein fertiges Skript übernehmen und nur bebildern.
 *
 * Der Unterschied zu generateFinance() ist der ganze Zweck: dort schreibt das
 * Modell den Text, hier bekommt es ihn und darf ihn nicht anfassen. Zerlegt
 * wird im Code, zugeordnet vom Modell, und was gesprochen wird, stammt Zeichen
 * für Zeichen aus dem, was eingefügt wurde.
 *
 * Die Zusage wird geprüft, nicht behauptet: nach dem Zerlegen wird der Text
 * gegen das Original gehalten, und ein Unterschied bricht ab, statt ein Video
 * zu erzeugen, das etwas anderes sagt als bestellt.
 */
/**
 * Ein Klangteppich, wie ihn das Modell schreibt, als Klang des Projekts.
 *
 * Dieselbe Prüfung wie in writeOutline(), nur für genau einen: ohne
 * Beschreibung gibt es nichts zu erzeugen, und die Sekunden werden auf das
 * gestutzt, was geschleift noch nach Musik klingt. Null heißt: keine Musik,
 * nicht "kaputt" — ein Video ohne Ton ist schlechter als eines mit, aber
 * immer noch besser als gar keines.
 */
function readMusicBed(raw: unknown): StorySound | null {
  const b = (raw ?? {}) as {
    key?: unknown;
    name?: unknown;
    prompt?: unknown;
    seconds?: unknown;
  };
  const name = typeof b.name === "string" ? b.name.trim() : "";
  const prompt = typeof b.prompt === "string" ? b.prompt.trim() : "";
  if (prompt.length < 6) return null;
  const key = slugify(typeof b.key === "string" && b.key ? b.key : name);
  if (!key) return null;
  return {
    key,
    name: name.slice(0, 120) || key,
    prompt: trimSoundPrompt(prompt, SOUND_PROMPT_LIMIT),
    kind: "ambience",
    seconds: Math.min(20, Math.max(8, Math.round(Number(b.seconds) || 12))),
  };
}

/** Ein bekannter Teppich als Klang des Projekts. Die Rückfallebene. */
function fromLibrary(known: KnownSound | undefined): StorySound | null {
  return known
    ? {
        key: known.key,
        name: known.name,
        prompt: known.description,
        kind: "ambience",
        seconds: known.seconds,
      }
    : null;
}

export async function importFinanceScript(args: {
  jobId: string;
  script: string;
  apiKey: string;
  model?: TextModel;
  startedAt: number;
}): Promise<void> {
  const model = args.model ?? resolveTextModel(DEFAULT_FINANCE_MODEL);
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
      // Kann nur ein Fehler im Zerlegen sein — und dann lieber gar kein Video
      // als eines, das etwas anderes sagt.
      throw new Error(
        "Beim Zerlegen ging Text verloren. Das Video wurde nicht erzeugt.",
      );
    }

    await progress("Grafiken werden zugeordnet");
    const known = await soundLibrary({ music: true }).catch(() => ({
      beds: [] as KnownSound[],
      accents: [] as KnownSound[],
    }));
    const heard = known.beds[0];

    const reply = await complete({
      model,
      apiKey: args.apiKey,
      system: FINANCE_IMPORT_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: buildFinanceImportPrompt({
            sentences,
            beds: heard
              ? [
                  {
                    key: heard.key,
                    name: heard.name,
                    description: heard.description,
                  },
                ]
              : [],
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
      bed?: unknown;
      scenes?: unknown;
      spans?: unknown;
    };

    /**
     * Die Musik unter dem eingefügten Skript.
     *
     * Vorher wurde nur genommen, was die Bibliothek schon hatte — und ein
     * frischer Kanal hat nichts, also war ein eingefügtes Skript das einzige
     * Video ohne Ton. Jetzt schreibt das Modell eine, wenn keine da ist, und
     * übernimmt die vorhandene wörtlich, wenn es eine gibt: dann erkennt sie
     * das Erzeugen wieder und sie kostet nichts.
     *
     * Akzente gibt es hier weiterhin keine. Unter einem Diagramm knackt
     * nichts, und der Wunsch war ausdrücklich leise Hintergrundmusik.
     */
    const bed = readMusicBed(json.bed) ?? fromLibrary(heard);

    const assembled = assignScenes(
      sentences,
      json.scenes,
      json.spans,
      bed?.key,
    );
    const withNote = withDisclaimer({
      scenes: assembled.scenes,
      shots: assembled.shots,
    });

    const project = StoryProject.parse({
      kind: "finanz",
      id: `finance-${args.jobId}`,
      topic,
      title:
        typeof json.title === "string" && json.title.trim().length > 2
          ? json.title.trim().slice(0, 120)
          : sentences[0].slice(0, 80),
      style: {
        name: "Kanal-Identität",
        directive:
          "Not used by this format — finance scenes are drawn in code from the shared design tokens rather than generated from a prompt.",
        palette: ["#0E1A2B", "#E3B23C", "#4FB99F", "#C4452F"],
      },
      soundLevel: 0.1,
      scenes: withNote.scenes,
      sounds: bed ? [bed] : [],
      shots: withNote.shots,
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
 * Die Sätze sind gesetzt — sie kommen aus dem eingefügten Skript und werden
 * hier nur verteilt. Was das Modell liefert, ist eine Meinung darüber, welche
 * Grafik wohin gehört, und was davon nicht aufgeht, wird zurechtgerückt statt
 * abgelehnt: ein Satz ohne Szene bekommt die Szene davor. Eine Lücke in der
 * Zuordnung darf kein Video kosten, dessen Text schon feststeht.
 */
export function assignScenes(
  sentences: string[],
  rawScenes: unknown,
  rawSpans: unknown,
  bed?: string,
): { scenes: FinanceScene[]; shots: StoryShot[]; warning?: string } {
  const scenes: FinanceScene[] = [];
  let dropped = 0;

  for (const raw of Array.isArray(rawScenes) ? rawScenes : []) {
    const candidate = raw as { key?: unknown; name?: unknown };
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
    if (!scenes.some((s) => s.key === parsed.data.key))
      scenes.push(parsed.data);
  }

  if (!scenes.length) {
    throw new Error("Das Modell hat keine brauchbare Grafik geliefert.");
  }

  // Je Satz die Szene, in deren Spanne er liegt.
  const perSentence = new Array<string | undefined>(sentences.length);
  const keys = new Set(scenes.map((s) => s.key));
  for (const raw of Array.isArray(rawSpans) ? rawSpans : []) {
    const span = raw as { from?: unknown; to?: unknown; scene?: unknown };
    const key = slugify(typeof span.scene === "string" ? span.scene : "");
    if (!keys.has(key)) continue;
    const from = Math.max(0, Math.round(Number(span.from)));
    const to = Math.min(sentences.length - 1, Math.round(Number(span.to)));
    if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) continue;
    for (let i = from; i <= to; i += 1) perSentence[i] ??= key;
  }

  // Lücken schließen: erst nach vorn, dann der Anfang von hinten.
  let last: string | undefined;
  for (let i = 0; i < perSentence.length; i += 1) {
    if (perSentence[i]) last = perSentence[i];
    else perSentence[i] = last;
  }
  const first = perSentence.find(Boolean) ?? scenes[0].key;
  for (let i = 0; i < perSentence.length; i += 1) perSentence[i] ??= first;

  const gaps = perSentence.filter((k) => k === undefined).length;
  const shots: StoryShot[] = sentences.map((text, i) => ({
    id: `s${i + 1}`,
    text,
    image: perSentence[i]!,
    motion: "in",
    ambience: bed,
  }));

  const used = new Set(shots.map((s) => s.image));
  return {
    scenes: scenes.filter((s) => used.has(s.key)),
    shots,
    warning:
      dropped > 0
        ? `${dropped} ${dropped === 1 ? "Grafik wurde" : "Grafiken wurden"} verworfen, weil Pflichtangaben fehlten. Die betroffenen Sätze zeigen die Grafik davor. Der gesprochene Text ist unverändert.`
        : gaps > 0
          ? "Für einen Teil der Sätze hat das Modell keine Grafik zugeordnet — dort bleibt die vorige stehen. Der gesprochene Text ist unverändert."
          : undefined,
  };
}
