import Anthropic from "@anthropic-ai/sdk";
import { waitUntil } from "@vercel/functions";
import { errorResponse, guard } from "../../../lib/guardrails";
import {
  buildRepairPrompt,
  buildScenesPrompt,
  buildVoiceoverPrompt,
  SCENES_SYSTEM_PROMPT,
  VOICEOVER_SYSTEM_PROMPT,
} from "../../../lib/prompt";
import type { ScriptDraft as ScriptDraftType } from "../../../lib/schema";
import { draftToProject, ScriptDraft, ScriptRequest } from "../../../lib/schema";
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

    // ---- 2. The scenes, derived from that finished text. ------------------
    await update({ step: "Szenen werden gesetzt" });

    const messages: Anthropic.MessageParam[] = [
      { role: "user", content: buildScenesPrompt(voiceover) },
    ];

    // Two attempts at most: one chance to repair its own output, with the
    // failures named. Beyond that we surface the problem instead of burning
    // tokens in a loop.
    for (let attempt = 0; attempt < 2; attempt++) {
      const message = await client.messages.create({
        model: MODEL,
        max_tokens: 8000,
        system: SCENES_SYSTEM_PROMPT,
        messages,
      });

      if (message.stop_reason === "refusal") {
        await update({
          status: "error",
          error:
            "Das Modell hat dieses Thema abgelehnt. Formuliere das Stichwort anders oder wähle ein anderes Thema.",
        });
        return;
      }

      const raw = textOf(message);
      const parsed = parseSceneJson(raw, voiceover);

      if (!parsed.ok) {
        if (attempt === 1) {
          await update({ status: "error", error: parsed.error });
          return;
        }
        messages.push(
          { role: "assistant", content: raw },
          { role: "user", content: buildRepairPrompt([parsed.error]) },
        );
        continue;
      }

      const problems = validateDraft(parsed.draft);
      if (problems.length === 0) {
        const project = draftToProject(
          parsed.draft,
          topic,
          `p${Date.now().toString(36)}`,
        );
        await update({ status: "done", project, step: undefined });
        return;
      }

      if (attempt === 1) {
        await update({
          status: "error",
          error: `Die Szenenliste war auch nach einem Korrekturversuch ungültig: ${problems
            .slice(0, 3)
            .join(" ")}`,
        });
        return;
      }

      messages.push(
        { role: "assistant", content: raw },
        { role: "user", content: buildRepairPrompt(problems) },
      );
    }

    await update({ status: "error", error: "Skripterzeugung fehlgeschlagen." });
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
 * Pull the JSON object out of a model reply and validate it.
 *
 * Tolerates a fenced code block or a stray sentence around the object, because
 * insisting on cleanliness here costs a whole retry for something a substring
 * search fixes.
 */
function parseSceneJson(
  raw: string,
  voiceover: string,
):
  | { ok: true; draft: ScriptDraftType }
  | { ok: false; error: string } {
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

  // The voiceover is ours, not the model's, so it is spliced in rather than
  // asked for a second time.
  const parsed = ScriptDraft.safeParse({
    ...(value as Record<string, unknown>),
    voiceover,
  });
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 4)
      .map((i) => `${i.path.join(".") || "(Wurzel)"}: ${i.message}`)
      .join("; ");
    return { ok: false, error: `Das JSON passt nicht zum Schema: ${issues}` };
  }
  return { ok: true, draft: parsed.data };
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
function validateDraft(draft: ScriptDraftType): string[] {
  const problems: string[] = [];
  const words = draft.voiceover.trim().split(/\s+/).filter(Boolean).length;

  if (words < 600) {
    problems.push(
      `Das Voiceover hat nur ${words} Wörter, gefordert sind 750 bis 850.`,
    );
  }
  if (words > 1000) {
    problems.push(
      `Das Voiceover hat ${words} Wörter, gefordert sind 750 bis 850.`,
    );
  }

  if (draft.scenes.length < 6 || draft.scenes.length > 16) {
    problems.push(
      `Die Szenenliste hat ${draft.scenes.length} Einträge, gefordert sind 10 bis 14.`,
    );
  }

  let cursor = 0;
  draft.scenes.forEach((scene, i) => {
    const position = draft.voiceover.indexOf(scene.anchorPhrase, cursor);
    if (position === -1) {
      const anywhere = draft.voiceover.includes(scene.anchorPhrase);
      problems.push(
        anywhere
          ? `Szene ${i + 1} (${scene.type}): anchorPhrase "${scene.anchorPhrase}" steht im Voiceover vor der vorherigen Szene. Die Reihenfolge muss der Szenenliste entsprechen.`
          : `Szene ${i + 1} (${scene.type}): anchorPhrase "${scene.anchorPhrase}" kommt im Voiceover nicht wörtlich vor.`,
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

  // The colour turn is a dramatic device; more than one flip reads as noise.
  const turns = draft.scenes.filter(
    (s, i) =>
      s.phase === "solution" &&
      i > 0 &&
      draft.scenes[i - 1].phase !== "solution",
  ).length;
  if (turns > 1) {
    problems.push(
      `Die Phase wechselt ${turns}-mal von crisis auf solution. Erlaubt ist genau ein Wechsel.`,
    );
  }

  return problems;
}
