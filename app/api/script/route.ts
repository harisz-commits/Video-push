import Anthropic from "@anthropic-ai/sdk";
import { waitUntil } from "@vercel/functions";
import { z } from "zod";
import { errorResponse, guard } from "../../../lib/guardrails";
import {
  buildRepairPrompt,
  buildSegmentScenesPrompt,
  buildVoiceoverPrompt,
  SEGMENT_SCENES_SYSTEM_PROMPT,
  TITLE_SYSTEM_PROMPT,
  VOICEOVER_SYSTEM_PROMPT,
} from "../../../lib/prompt";
import type { DraftScene as DraftSceneType } from "../../../lib/schema";
import {
  draftToProject,
  DraftScene,
  ScriptRequest,
} from "../../../lib/schema";
import {
  readJson,
  scriptJobPath,
  writeJson,
  type ScriptJob,
} from "../../../lib/store";

export const runtime = "nodejs";
/**
 * Generating roughly 800 words plus a scene list is a few thousand output
 * tokens and regularly needs more than two minutes. 300 is the ceiling on
 * plans above Hobby, where the limit is 60 and this route cannot fit at all.
 */
export const maxDuration = 300;

const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5";

export async function POST(req: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return errorResponse(
      "ANTHROPIC_API_KEY ist nicht gesetzt. Trag den Key in den Vercel-Projekt-Einstellungen ein und zieh ihn mit `vercel env pull .env.local` lokal nach.",
      500,
    );
  }

  let topic: string;
  try {
    const parsed = ScriptRequest.parse(await req.json());
    topic = parsed.topic;
  } catch {
    return errorResponse(
      "Ungültige Anfrage. Erwartet wird { topic: string } mit 3 bis 200 Zeichen.",
      400,
    );
  }

  const allowed = await guard(req, "script", 6);
  if (!allowed.ok) return errorResponse(allowed.error, allowed.status);

  const jobId = `j${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const job: ScriptJob = {
    jobId,
    topic,
    status: "running",
    startedAt: Date.now(),
    updatedAt: Date.now(),
  };
  await writeJson(scriptJobPath(jobId), job);

  // Runs past this response. The browser gets an id straight away and polls
  // GET /api/script?jobId=… , so a closed tab no longer costs a script.
  waitUntil(generate(jobId, topic, apiKey));

  return Response.json({ jobId });
}

/** Poll target: the current state of a generation started by POST. */
export async function GET(req: Request) {
  const jobId = new URL(req.url).searchParams.get("jobId");
  if (!jobId || !/^[a-zA-Z0-9_-]{6,64}$/.test(jobId)) {
    return errorResponse("Ungültige oder fehlende jobId.", 400);
  }

  const job = await readJson<ScriptJob>(scriptJobPath(jobId));
  if (!job) {
    return errorResponse(
      "Zu dieser jobId gibt es keinen Auftrag. Entweder läuft er noch nicht oder er ist älter als die Aufbewahrungsfrist.",
      404,
    );
  }
  // A job whose function was killed mid-flight stays "running" forever: there
  // is nobody left to write the failure. Anything still running past the point
  // the function could legally live is dead, and saying so beats a spinner that
  // never stops.
  if (
    job.status === "running" &&
    Date.now() - job.startedAt > (maxDuration + 30) * 1000
  ) {
    return Response.json({
      ...job,
      status: "error",
      error:
        "Die Erzeugung wurde abgebrochen, weil sie das Zeitlimit der Funktion überschritten hat. Versuch es noch einmal.",
    } satisfies ScriptJob);
  }

  return Response.json(job);
}

async function generate(
  jobId: string,
  topic: string,
  apiKey: string,
): Promise<void> {
  const startedAt = Date.now();

  const update = async (patch: Partial<ScriptJob>): Promise<void> => {
    await writeJson(scriptJobPath(jobId), {
      jobId,
      topic,
      status: "running",
      startedAt,
      ...patch,
      updatedAt: Date.now(),
    } as ScriptJob).catch(() => {
      // Nothing useful to do here; the poller reports a stale job instead.
    });
  };

  const client = new Anthropic({ apiKey, maxRetries: 1 });

  try {
    // ---- 1. The voiceover, as prose. -------------------------------------
    await update({ step: "Voiceover wird geschrieben" });

    const voiceMessage = await client.messages.create({
      model: MODEL,
      max_tokens: 4000,
      system: VOICEOVER_SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildVoiceoverPrompt(topic) }],
    });

    const voiceover = textOf(voiceMessage).trim();
    if (voiceover.length < 200) {
      await update({
        status: "error",
        error: "Das Modell hat kein brauchbares Voiceover geliefert.",
      });
      return;
    }

    // ---- 2. The scenes, one slice of the text at a time. ------------------
    const segments = segmentVoiceover(voiceover);
    await update({
      step: `Szenen werden gesetzt (${segments.length} Abschnitte parallel)`,
    });

    // The slices are independent, so they go out together. Sequentially this
    // step took longer than the function is allowed to live.
    const [title, ...results] = await Promise.all([
      writeTitle(client, topic, voiceover),
      ...segments.map((segment, i) =>
        scenesForSegment(client, {
          segment,
          index: i,
          total: segments.length,
          topic,
        }),
      ),
    ]);

    const failed = results.find((r) => !r.ok);
    if (failed && !failed.ok) {
      await update({ status: "error", error: failed.error });
      return;
    }

    const scenes = normalizePhases(
      results.flatMap((r) => (r.ok ? r.scenes : [])),
    );

    const problems = validateWhole(scenes, voiceover);
    if (problems.length > 0) {
      await update({
        status: "error",
        error: `Die Szenenliste war ungültig: ${problems.slice(0, 3).join(" ")}`,
      });
      return;
    }

    const project = draftToProject(
      { title, voiceover, scenes },
      topic,
      `p${Date.now().toString(36)}`,
    );
    await update({ status: "done", project, step: undefined });
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) {
      await update({
        status: "error",
        error:
          "Die Anthropic-API ist gerade ausgelastet. Versuch es in einer Minute erneut.",
      });
      return;
    }
    if (err instanceof Anthropic.APIError) {
      await update({
        status: "error",
        error: `Die Anthropic-API antwortete mit ${err.status} für das Modell "${MODEL}".${apiErrorDetail(err)}`,
      });
      return;
    }
    // eslint-disable-next-line no-console
    console.error("[/api/script]", err);
    await update({
      status: "error",
      error: "Unerwarteter Fehler bei der Skripterzeugung.",
    });
  }
}

/** Concatenate the text blocks of a message. */
function textOf(message: Anthropic.Message): string {
  return message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");
}

/**
 * Cut the voiceover into slices the scene pass can handle one at a time.
 *
 * Slices follow paragraph breaks so a slice is never cut mid-thought, and they
 * are packed to roughly equal length so no single call ends up with twice the
 * work of its siblings — the step costs as much as its slowest slice. A text
 * with too few paragraphs to divide is re-cut at sentence boundaries instead.
 */
const WORDS_PER_SEGMENT = 110;
const MAX_SEGMENTS = 10;

function segmentVoiceover(voiceover: string): string[] {
  const words = voiceover.trim().split(/\s+/).filter(Boolean).length;
  const target = Math.min(
    MAX_SEGMENTS,
    Math.max(3, Math.round(words / WORDS_PER_SEGMENT)),
  );

  let units = voiceover.split(/\n\s*\n+/).map((p) => p.trim()).filter(Boolean);
  if (units.length < target) {
    units = voiceover
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  if (units.length <= target) return units;

  const perSegment = words / target;
  const segments: string[] = [];
  let current: string[] = [];
  let currentWords = 0;

  for (const [i, unit] of units.entries()) {
    current.push(unit);
    currentWords += unit.split(/\s+/).length;
    const remainingUnits = units.length - i - 1;
    const remainingSlots = target - segments.length - 1;
    // Close the slice once it is full, but never so late that the slices left
    // over outnumber the units left to fill them.
    if (
      (currentWords >= perSegment && remainingSlots > 0) ||
      remainingUnits === remainingSlots
    ) {
      segments.push(current.join("\n\n"));
      current = [];
      currentWords = 0;
    }
  }
  if (current.length > 0) segments.push(current.join("\n\n"));
  return segments;
}

type SegmentResult =
  | { ok: true; scenes: DraftSceneType[] }
  | { ok: false; error: string };

/** Scenes for one slice, with a single chance to repair its own output. */
async function scenesForSegment(
  client: Anthropic,
  args: { segment: string; index: number; total: number; topic: string },
): Promise<SegmentResult> {
  const spokenSeconds = (args.segment.split(/\s+/).filter(Boolean).length / 150) * 60;
  const wantScenes = Math.max(3, Math.round(spokenSeconds / 6));

  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: buildSegmentScenesPrompt({
        segment: args.segment,
        index: args.index,
        total: args.total,
        wantScenes,
        isFirst: args.index === 0,
        isLast: args.index === args.total - 1,
        topic: args.topic,
      }),
    },
  ];

  const label = `Abschnitt ${args.index + 1}`;

  for (let attempt = 0; attempt < 2; attempt++) {
    const message = await client.messages.create({
      model: MODEL,
      // Generous next to the six or seven scenes a slice asks for. The reply
      // is not the only thing counted against this ceiling, and a truncated
      // reply costs the whole script.
      max_tokens: 16000,
      system: SEGMENT_SCENES_SYSTEM_PROMPT,
      messages,
    });

    if (message.stop_reason === "refusal") {
      return {
        ok: false,
        error:
          "Das Modell hat dieses Thema abgelehnt. Formuliere das Stichwort anders oder wähle ein anderes Thema.",
      };
    }

    const raw = textOf(message);

    // A reply cut off at the token ceiling is not a formatting problem and no
    // repair round will fix it, so say what actually happened.
    if (message.stop_reason === "max_tokens") {
      return {
        ok: false,
        error: `${label}: die Antwort wurde beim Token-Limit abgeschnitten (${message.usage.output_tokens} Tokens). Weniger Szenen pro Abschnitt anfordern.`,
      };
    }

    const parsed = parseScenes(raw);

    const problems = parsed.ok
      ? validateScenes(parsed.scenes, args.segment, {
          wantScenes,
          isFirst: args.index === 0,
          isLast: args.index === args.total - 1,
        })
      : [parsed.error];

    if (parsed.ok && problems.length === 0) return { ok: true, scenes: parsed.scenes };

    if (attempt === 1) {
      // The reply itself is the evidence when the reply is the problem —
      // "enthielt kein JSON-Objekt" alone leaves nothing to act on.
      const evidence = parsed.ok
        ? ""
        : ` Antwort begann mit: ${JSON.stringify(raw.slice(0, 200))} (stop_reason ${message.stop_reason}, ${raw.length} Zeichen)`;
      return {
        ok: false,
        error: `${label} war auch nach einem Korrekturversuch ungültig: ${problems
          .slice(0, 3)
          .join(" ")}${evidence}`,
      };
    }

    messages.push(
      // An empty text block is rejected by the API, and an empty reply is
      // exactly one of the ways this step fails.
      { role: "assistant", content: raw.trim() || "(leere Antwort)" },
      { role: "user", content: buildRepairPrompt(problems) },
    );
  }

  return { ok: false, error: `${label} konnte nicht erzeugt werden.` };
}

async function writeTitle(
  client: Anthropic,
  topic: string,
  voiceover: string,
): Promise<string> {
  try {
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 100,
      system: TITLE_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Thema: ${topic}\n\nAnfang des Voiceovers:\n${voiceover.slice(0, 600)}`,
        },
      ],
    });
    const title = textOf(message).trim().replace(/^["„»]|["“«]$/g, "");
    return title.length >= 3 ? title.slice(0, 120) : topic;
  } catch {
    // A missing title is not worth failing a finished script over.
    return topic;
  }
}

/**
 * Exactly one colour turn, decided here rather than asked for.
 *
 * The slices are written in parallel and none of them can see what the others
 * marked, so the turn cannot be their job. The first scene anyone flagged as
 * "solution" becomes the turn and everything falls in line behind it — which is
 * what the phase means dramatically anyway.
 */
function normalizePhases(scenes: DraftSceneType[]): DraftSceneType[] {
  const turn = scenes.findIndex((s) => s.phase === "solution");
  return scenes.map((scene, i) => ({
    ...scene,
    phase: turn >= 0 && i >= turn ? ("solution" as const) : ("crisis" as const),
  }));
}

/**
 * Pull the scene array out of a model reply.
 *
 * Tolerates a fenced code block or a stray sentence around the object, because
 * insisting on cleanliness here costs a whole retry for something a substring
 * search fixes.
 */
function parseScenes(
  raw: string,
): { ok: true; scenes: DraftSceneType[] } | { ok: false; error: string } {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) {
    return { ok: false, error: "Die Antwort enthielt kein JSON-Objekt." };
  }

  let value: unknown;
  try {
    value = JSON.parse(raw.slice(start, end + 1));
  } catch (err) {
    return {
      ok: false,
      error: `Das JSON ließ sich nicht parsen: ${(err as Error).message}`,
    };
  }

  const parsed = z
    .object({ scenes: z.array(DraftScene) })
    .safeParse(value);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 4)
      .map((i) => `${i.path.join(".") || "(Wurzel)"}: ${i.message}`)
      .join("; ");
    return { ok: false, error: `Das JSON passt nicht zum Schema: ${issues}` };
  }
  return { ok: true, scenes: parsed.data.scenes };
}

/** The human-readable part of an Anthropic error, if there is one. */
function apiErrorDetail(err: InstanceType<typeof Anthropic.APIError>): string {
  const body = err.error as { error?: { message?: string } } | undefined;
  const message = body?.error?.message ?? err.message;
  return message ? ` ${message.slice(0, 300)}` : "";
}

/**
 * Checks the model cannot make on its own.
 *
 * The anchor rule is the important one: if a phrase is not a verbatim substring
 * of the voiceover, that scene has no timestamp to attach to and the whole
 * automatic-timing idea collapses for it. Catching it here — where we can ask
 * for a fix — is far better than warning about it in the UI later.
 */
function validateScenes(
  scenes: DraftSceneType[],
  text: string,
  opts: { wantScenes: number; isFirst: boolean; isLast: boolean },
): string[] {
  const problems: string[] = [];

  // Density is the point: a still image that holds for twenty seconds is the
  // single biggest reason a finished video feels dead.
  if (scenes.length < Math.max(2, Math.round(opts.wantScenes * 0.6))) {
    problems.push(
      `Der Abschnitt hat nur ${scenes.length} Szenen, gefordert sind rund ${opts.wantScenes} — alle vier bis acht Sekunden eine neue Szene.`,
    );
  }
  if (opts.isFirst && scenes[0]?.type !== "hook") {
    problems.push(`Die erste Szene muss "hook" sein, ist aber "${scenes[0]?.type}".`);
  }
  if (opts.isLast && scenes[scenes.length - 1]?.type !== "closer") {
    problems.push(
      `Die letzte Szene muss "closer" sein, ist aber "${scenes[scenes.length - 1]?.type}".`,
    );
  }

  let cursor = 0;
  scenes.forEach((scene, i) => {
    const position = text.indexOf(scene.anchorPhrase, cursor);
    if (position === -1) {
      const anywhere = text.includes(scene.anchorPhrase);
      problems.push(
        anywhere
          ? `Szene ${i + 1} (${scene.type}): anchorPhrase "${scene.anchorPhrase}" steht im Abschnitt vor der vorherigen Szene. Die Reihenfolge muss der Szenenliste entsprechen.`
          : `Szene ${i + 1} (${scene.type}): anchorPhrase "${scene.anchorPhrase}" kommt im Abschnitt nicht wörtlich vor.`,
      );
    } else {
      cursor = position + 1;
    }

    // The draft schema is flat — one object shape for all nine types, because
    // a nine-branch union compiles to a grammar the API rejects as too large.
    // The per-type requirements therefore live here, and a miss is reported by
    // name so the repair round has something concrete to fix.
    const need = (ok: boolean, what: string) => {
      if (!ok) {
        problems.push(
          `Szene ${i + 1} (${scene.type}): ${what} fehlt oder ist unvollständig.`,
        );
      }
    };

    switch (scene.type) {
      case "counter":
        need(Boolean(scene.values?.length), '"values" mit ein bis drei Zahlen');
        break;
      case "iconGrid":
        need(
          Boolean(scene.icon) &&
            scene.total != null &&
            scene.remaining != null,
          '"icon", "total" und "remaining"',
        );
        if (
          scene.total != null &&
          scene.remaining != null &&
          scene.remaining > scene.total
        ) {
          problems.push(
            `Szene ${i + 1} (iconGrid): remaining (${scene.remaining}) ist größer als total (${scene.total}).`,
          );
        }
        if (scene.total != null && (scene.total < 1 || scene.total > 64)) {
          problems.push(
            `Szene ${i + 1} (iconGrid): total muss zwischen 1 und 64 liegen, ist aber ${scene.total}.`,
          );
        }
        break;
      case "mapFlow":
        need(Boolean(scene.flows?.length), '"flows" mit mindestens einem Strom');
        break;
      case "chain":
        need(
          Boolean(scene.nodes && scene.nodes.length >= 2),
          '"nodes" mit mindestens zwei Knoten',
        );
        if (
          scene.nodes &&
          scene.breakAt != null &&
          (scene.breakAt < 0 || scene.breakAt >= scene.nodes.length)
        ) {
          problems.push(
            `Szene ${i + 1} (chain): breakAt (${scene.breakAt}) liegt außerhalb der ${scene.nodes.length} Knoten.`,
          );
        }
        break;
      case "split":
        need(
          Boolean(scene.panels && scene.panels.length >= 2),
          '"panels" mit genau zwei Einträgen',
        );
        break;
      case "chart":
        need(
          Boolean(scene.series && scene.series.length >= 2 && scene.labels),
          '"series" und "labels" mit mindestens zwei Werten',
        );
        if (
          scene.series &&
          scene.labels &&
          scene.series.length !== scene.labels.length
        ) {
          problems.push(
            `Szene ${i + 1} (chart): ${scene.series.length} Werte, aber ${scene.labels.length} Beschriftungen.`,
          );
        }
        break;
      case "pillars":
        need(
          Boolean(scene.pillars && scene.pillars.length >= 2 && scene.carries),
          '"pillars" mit mindestens zwei Säulen und "carries"',
        );
        if (
          scene.pillars &&
          scene.unstableIndex != null &&
          (scene.unstableIndex < 0 ||
            scene.unstableIndex >= scene.pillars.length)
        ) {
          problems.push(
            `Szene ${i + 1} (pillars): unstableIndex (${scene.unstableIndex}) liegt außerhalb der ${scene.pillars.length} Säulen.`,
          );
        }
        break;
      case "closer":
        need(Boolean(scene.statement), '"statement"');
        break;
      default:
        break;
    }
  });

  return problems;
}

/**
 * The checks that only make sense once the slices are back together.
 *
 * Each slice was already validated against its own text; what is left is
 * whether the assembled script is a whole video — long enough, dense enough,
 * and with its anchors still in reading order across the seams.
 */
function validateWhole(scenes: DraftSceneType[], voiceover: string): string[] {
  const problems: string[] = [];
  const words = voiceover.trim().split(/\s+/).filter(Boolean).length;
  const spokenSeconds = (words / 150) * 60;
  const wanted = Math.round(spokenSeconds / 6);

  if (words < 600) {
    problems.push(
      `Das Voiceover hat nur ${words} Wörter, gefordert sind 750 bis 850.`,
    );
  }
  if (scenes.length < wanted * 0.6) {
    problems.push(
      `Die Szenenliste hat nur ${scenes.length} Einträge. Bei ${Math.round(spokenSeconds)} Sekunden Text sind rund ${wanted} nötig.`,
    );
  }

  let cursor = 0;
  for (const [i, scene] of scenes.entries()) {
    const position = voiceover.indexOf(scene.anchorPhrase, cursor);
    if (position === -1) {
      problems.push(
        `Szene ${i + 1} (${scene.type}): anchorPhrase "${scene.anchorPhrase}" steht nicht in der Reihenfolge im Voiceover.`,
      );
      break;
    }
    cursor = position + 1;
  }

  return problems;
}
