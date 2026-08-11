import Anthropic from "@anthropic-ai/sdk";
import {
  buildRepairPrompt,
  buildResearchPrompt,
  buildSegmentScenesPrompt,
  buildVoiceoverPrompt,
  RESEARCH_SYSTEM_PROMPT,
  SEGMENT_SCENES_SYSTEM_PROMPT,
  TITLE_SYSTEM_PROMPT,
  VOICEOVER_SYSTEM_PROMPT,
} from "./prompt";
import type { DraftScene as DraftSceneType } from "./schema";
import { draftToProject, DraftScene } from "./schema";
import { readJson, scriptJobPath, writeJson, type ScriptJob } from "./store";
import { z } from "zod";

/**
 * Script generation, in two phases that run as two separate function calls.
 *
 * They are split because they could not both fit in one. A function may live
 * for five minutes; looking facts up on the web repeatedly took longer than
 * that on its own, and killed the writing it exists to serve. Splitting gives
 * each phase its own five minutes, which is the only way the research step can
 * take the time it genuinely needs without starving everything downstream.
 *
 * The handover is a request the first phase makes to the second, carrying a
 * token minted when the job was created. The token is what makes the second
 * phase safe to expose: without it the endpoint would let anyone re-run the
 * expensive half of somebody else's job.
 */

const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5";

/**
 * Thinking depth, set explicitly per step.
 *
 * Sonnet 5 thinks adaptively at effort "high" whenever nothing says otherwise,
 * and nothing here did — which is why a research call with four web searches
 * ran for five and a half minutes. Effort is the documented lever, and the
 * right level differs by job: searching and summarising is not the same work
 * as writing the script.
 */
const EFFORT = {
  research: "low",
  voiceover: (process.env.ANTHROPIC_EFFORT as "low" | "medium" | "high") ?? "medium",
  scenes: "low",
  title: "low",
} as const;

export function newContinueToken(): string {
  return `k${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

function client(apiKey: string): Anthropic {
  return new Anthropic({ apiKey, maxRetries: 1 });
}

function updater(jobId: string, topic: string, startedAt: number) {
  return async (patch: Partial<ScriptJob>): Promise<void> => {
    const existing = await readJson<ScriptJob>(scriptJobPath(jobId)).catch(
      () => null,
    );
    await writeJson(scriptJobPath(jobId), {
      ...(existing ?? { jobId, topic, status: "running", startedAt }),
      ...patch,
      updatedAt: Date.now(),
    } as ScriptJob).catch(() => {
      // Nothing useful to do here; the poller reports a stale job instead.
    });
  };
}

/** Turn any thrown thing into the message the studio should show. */
function describe(err: unknown): string {
  if (err instanceof Anthropic.RateLimitError) {
    return "Die Anthropic-API ist gerade ausgelastet. Versuch es in einer Minute erneut.";
  }
  if (err instanceof Anthropic.APIError) {
    return `Die Anthropic-API antwortete mit ${err.status} für das Modell "${MODEL}".${apiErrorDetail(err)}`;
  }
  // eslint-disable-next-line no-console
  console.error("[pipeline]", err);
  return "Unerwarteter Fehler bei der Skripterzeugung.";
}

/**
 * Phase one: gather the facts, then hand off.
 *
 * The handover is awaited only as far as the acknowledgement — the second
 * phase does its work in its own invocation, on its own clock.
 */
export async function researchPhase(args: {
  jobId: string;
  topic: string;
  apiKey: string;
  origin: string;
  token: string;
  startedAt: number;
}): Promise<void> {
  const update = updater(args.jobId, args.topic, args.startedAt);

  try {
    await update({ step: "Fakten werden recherchiert" });
    const { text: research, searches } = await researchFacts(
      client(args.apiKey),
      args.topic,
    );

    if (searches === 0) {
      await update({
        status: "error",
        research,
        error:
          "Die Websuche hat kein einziges Ergebnis geliefert, also gibt es keine belegten Zahlen — und ohne die wird kein Skript geschrieben, sonst erfindet das Modell sie. Prüf, ob Websuche für diesen Anthropic-Account freigeschaltet ist.",
      });
      return;
    }
    if (research.length < 80) {
      await update({
        status: "error",
        research,
        error: "Die Faktenrecherche hat keine brauchbare Liste geliefert.",
      });
      return;
    }

    await update({ step: "Voiceover wird geschrieben", research });

    // The sheet travels in the request rather than being re-read from storage:
    // the second phase would otherwise depend on a write that may not be
    // visible yet, which is exactly how the first handover failed.
    const response = await fetch(`${args.origin}/api/script/continue`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jobId: args.jobId, token: args.token, research }),
    });

    if (!response.ok) {
      await update({
        status: "error",
        research,
        error: `Die Recherche ist fertig, aber der Schreibschritt liess sich nicht starten (${response.status}). Versuch es noch einmal.`,
      });
    }
  } catch (err) {
    await update({ status: "error", error: describe(err) });
  }
}

/** Phase two: write the voiceover and derive the scenes from it. */
export async function writePhase(args: {
  jobId: string;
  topic: string;
  research: string;
  apiKey: string;
  startedAt: number;
}): Promise<void> {
  const update = updater(args.jobId, args.topic, args.startedAt);
  const anthropic = client(args.apiKey);
  const { topic, research } = args;

  try {
    const voice = await writeVoiceover(anthropic, topic, research);
    if (!voice.ok) {
      await update({ status: "error", error: voice.error });
      return;
    }
    const voiceover = voice.text;

    const segments = segmentVoiceover(voiceover);
    await update({
      step: `Szenen werden gesetzt (${segments.length} Abschnitte parallel)`,
    });

    // The slices are independent, so they go out together. Sequentially this
    // step took longer than the function is allowed to live.
    const [title, ...results] = await Promise.all([
      writeTitle(anthropic, topic, voiceover),
      ...segments.map((segment, i) =>
        scenesForSegment(anthropic, {
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

    const scenes = normalizePhases(results.flatMap((r) => (r.ok ? r.scenes : [])));

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
    await update({ status: "error", error: describe(err) });
  }
}

/**
 * Look the facts up before anything is written.
 *
 * Web search runs on Anthropic's side: the tool is declared and the model
 * searches, reads and cites without anything round-tripping through here. The
 * server loop can pause after ten iterations with stop_reason "pause_turn",
 * which is not an error — the turn is resumed by sending the conversation back
 * unchanged, and a cap keeps a runaway search from eating the function's life.
 *
 * `max_uses` is both the cost lever and the time lever, and time turned out to
 * be the binding one: at eight searches this step ran five and a half minutes
 * and consumed the entire function budget on its own, leaving nothing for the
 * writing it exists to serve. Four searches is enough for the handful of
 * numbers a script needs, and the deadline below guarantees the step gives up
 * its remaining searches rather than the rest of the pipeline.
 */
const MAX_SEARCHES = 6;
const MAX_RESUMES = 3;
/** Hard ceiling on the research phase, well inside the function's own limit. */
const RESEARCH_BUDGET_MS = 240_000;

async function researchFacts(
  client: Anthropic,
  topic: string,
): Promise<{ text: string; searches: number }> {
  const deadline = Date.now() + RESEARCH_BUDGET_MS;
  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: buildResearchPrompt(topic) },
  ];

  for (let resume = 0; resume <= MAX_RESUMES; resume++) {
    if (Date.now() > deadline) break;

    const message = await client.messages.create(
      {
        model: MODEL,
        max_tokens: 4000,
        output_config: { effort: EFFORT.research },
        system: RESEARCH_SYSTEM_PROMPT,
        tools: [
          {
            type: "web_search_20260209",
            name: "web_search",
            max_uses: MAX_SEARCHES,
          },
        ],
        messages,
      },
      // The deadline above only helps between turns; a single search turn can
      // block for minutes on its own, so the request itself gets a hard cap.
      // No retry — a second attempt would spend the budget the first one blew.
      { timeout: Math.max(20_000, deadline - Date.now()), maxRetries: 0 },
    );

    if (message.stop_reason === "pause_turn") {
      // The server-side search loop hit its iteration limit mid-turn. Sending
      // the assistant turn straight back resumes it; no extra user message.
      // Past the deadline we stop resuming and take whatever has been found —
      // a shorter fact sheet beats a killed function.
      if (Date.now() > deadline) {
        return { text: lastText(message), searches: countSearches(message) };
      }
      messages.push({ role: "assistant", content: message.content });
      continue;
    }

    return { text: lastText(message), searches: countSearches(message) };
  }

  return { text: "", searches: 0 };
}

/**
 * How many web searches actually came back with results.
 *
 * A model whose searches all failed does not fall silent — it apologises, at
 * length, in fluent German, and that apology is a non-empty string. Accepting
 * it as a fact sheet is how unverified numbers would get into a script through
 * the very step built to keep them out. Counting the results is the only
 * honest check: either the web was consulted or it was not.
 */
function countSearches(message: Anthropic.Message): number {
  let ok = 0;
  for (const block of message.content as { type: string; content?: unknown }[]) {
    if (block.type !== "web_search_tool_result") continue;
    // A successful result carries a list; a failed one carries an error object.
    if (Array.isArray(block.content)) ok += block.content.length > 0 ? 1 : 0;
  }
  return ok;
}

/**
 * The finished answer out of a reply that also contains search machinery.
 *
 * A search turn interleaves the model's tool calls, their results and its own
 * text. Only the text is wanted, and the last block is the finished list — the
 * earlier ones are narration between searches.
 */
function lastText(message: Anthropic.Message): string {
  const texts = message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text.trim())
    .filter(Boolean);

  return texts.length > 0 ? texts[texts.length - 1] : "";
}

/**
 * Formal address, found rather than forbidden.
 *
 * The prompt has asked for "du" throughout for a while and the model has kept
 * slipping, because nothing checked. Anchor phrases only became reliable once
 * they were validated, and this is the same fix.
 *
 * Capitalisation carries the whole distinction in German: lowercase "sie" is
 * she or they, capitalised "Sie" mid-sentence is the formal you. At the start
 * of a sentence the two are indistinguishable, so those are left alone — a
 * missed slip is better than rejecting a correct script.
 */
const FORMAL_WORDS = /\b(Sie|Ihnen|Ihr|Ihre|Ihrem|Ihren|Ihrer|Ihres)\b/g;

function formalAddressHits(text: string): string[] {
  const hits: string[] = [];

  for (const match of text.matchAll(FORMAL_WORDS)) {
    const at = match.index ?? 0;
    // Everything before it on this sentence; empty means it opens one, where
    // the capital is just orthography. A colon does not start a sentence in
    // German — a capitalised pronoun right after one is the formal address,
    // not a coincidence of position.
    const before = text.slice(Math.max(0, at - 200), at);
    if (/(^|[.!?„"\n])\s*$/.test(before)) continue;

    const from = Math.max(0, at - 30);
    hits.push(`…${text.slice(from, at + match[0].length + 20).replace(/\s+/g, " ")}…`);
  }

  return hits;
}

/** The voiceover, with one chance to fix the things we can actually check. */
async function writeVoiceover(
  client: Anthropic,
  topic: string,
  research: string,
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: buildVoiceoverPrompt(topic, research) },
  ];

  for (let attempt = 0; attempt < 2; attempt++) {
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 4000,
      output_config: { effort: EFFORT.voiceover },
      system: VOICEOVER_SYSTEM_PROMPT,
      messages,
    });

    const text = textOf(message).trim();
    const problems: string[] = [];

    if (text.length < 200) {
      problems.push("Der Text ist zu kurz oder leer.");
    }

    const words = text.split(/\s+/).filter(Boolean).length;
    if (words > 0 && words < 600) {
      problems.push(`Der Text hat nur ${words} Wörter, gefordert sind 750 bis 850.`);
    }

    const formal = formalAddressHits(text);
    if (formal.length > 0) {
      problems.push(
        `Der Text siezt an ${formal.length} Stelle(n). Gefordert ist durchgehend die Du-Form — "stell dir vor", nicht "stellen Sie sich vor". Betroffen: ${formal
          .slice(0, 3)
          .join(" | ")}`,
      );
    }

    if (problems.length === 0) return { ok: true, text };

    if (attempt === 1) {
      return {
        ok: false,
        error: `Das Voiceover war auch nach einem Korrekturversuch ungültig: ${problems.join(" ")}`,
      };
    }

    messages.push(
      { role: "assistant", content: text || "(leere Antwort)" },
      { role: "user", content: buildRepairPrompt(problems) },
    );
  }

  return { ok: false, error: "Das Voiceover konnte nicht erzeugt werden." };
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
      output_config: { effort: EFFORT.scenes },
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
      output_config: { effort: EFFORT.title },
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
      case "stage":
        need(
          Boolean(scene.cast?.length),
          '"cast" mit ein bis fünf Figuren',
        );
        if (
          scene.cast &&
          scene.focusIndex != null &&
          (scene.focusIndex < 0 || scene.focusIndex >= scene.cast.length)
        ) {
          problems.push(
            `Szene ${i + 1} (stage): focusIndex (${scene.focusIndex}) liegt außerhalb der ${scene.cast.length} Figuren.`,
          );
        }
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
