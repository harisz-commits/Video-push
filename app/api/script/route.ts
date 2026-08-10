import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { errorResponse, guard } from "../../../lib/guardrails";
import {
  buildRepairPrompt,
  buildScriptUserPrompt,
  SCRIPT_SYSTEM_PROMPT,
} from "../../../lib/prompt";
import type { ScriptDraft as ScriptDraftType } from "../../../lib/schema";
import { draftToProject, ScriptDraft, ScriptRequest } from "../../../lib/schema";

export const runtime = "nodejs";
export const maxDuration = 120;

const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5";

/**
 * How hard the model works on the script.
 *
 * Sent only when explicitly configured. Not every model accepts every effort
 * level, and an unsupported value is a 400 for the whole request — not worth
 * risking for a parameter nobody asked for. Set ANTHROPIC_EFFORT=low if the
 * route needs to fit inside a 60-second function timeout, or high for better
 * scripts where there is room.
 */
const EFFORT = process.env.ANTHROPIC_EFFORT as
  | "low"
  | "medium"
  | "high"
  | undefined;

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

  const client = new Anthropic({ apiKey });

  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: buildScriptUserPrompt(topic) },
  ];

  try {
    // Two attempts at most: the model gets exactly one chance to repair its
    // own output, with the concrete failures named. Beyond that we surface the
    // problem instead of burning tokens in a loop.
    for (let attempt = 0; attempt < 2; attempt++) {
      const message = await client.messages.parse({
        model: MODEL,
        max_tokens: 16000,
        system: SCRIPT_SYSTEM_PROMPT,
        thinking: { type: "adaptive" },
        output_config: {
          ...(EFFORT ? { effort: EFFORT } : {}),
          format: zodOutputFormat(ScriptDraft),
        },
        messages,
      });

      if (message.stop_reason === "refusal") {
        return errorResponse(
          "Das Modell hat dieses Thema abgelehnt. Formuliere das Stichwort anders oder wähle ein anderes Thema.",
          422,
        );
      }

      const draft = message.parsed_output;
      if (!draft) {
        return errorResponse(
          message.stop_reason === "max_tokens"
            ? "Die Antwort wurde abgeschnitten, bevor sie vollständig war. Versuch es mit einem enger gefassten Stichwort."
            : "Das Modell hat kein auswertbares Skript geliefert.",
          502,
        );
      }

      const problems = validateDraft(draft);
      if (problems.length === 0) {
        const project = draftToProject(draft, topic, `p${Date.now().toString(36)}`);
        return Response.json({ project });
      }

      if (attempt === 1) {
        return errorResponse(
          `Das Skript war auch nach einem Korrekturversuch ungültig: ${problems
            .slice(0, 3)
            .join(" ")}`,
          502,
        );
      }

      // Feed the failed draft back as a complete assistant turn, then the
      // repair request. The assistant turn is not the last message, so this is
      // ordinary conversation history rather than a prefill.
      messages.push(
        { role: "assistant", content: JSON.stringify(draft) },
        { role: "user", content: buildRepairPrompt(problems) },
      );
    }

    return errorResponse("Skripterzeugung fehlgeschlagen.", 502);
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) {
      return errorResponse(
        "Die Anthropic-API ist gerade ausgelastet. Versuch es in einer Minute erneut.",
        429,
      );
    }
    if (err instanceof Anthropic.APIError) {
      // Pass the API's own words through. A bare status code sent us guessing
      // at the model name when the real complaint was about a parameter.
      const detail = apiErrorDetail(err);
      return errorResponse(
        `Die Anthropic-API antwortete mit ${err.status} für das Modell "${MODEL}".${detail}`,
        502,
      );
    }
    // eslint-disable-next-line no-console
    console.error("[/api/script]", err);
    return errorResponse("Unerwarteter Fehler bei der Skripterzeugung.", 500);
  }
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
        need(Boolean(scene.left && scene.right), '"left" und "right"');
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
