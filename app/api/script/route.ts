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

const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6";

/**
 * How hard the model works on the script.
 *
 * Defaults to "low" because this route has to finish inside the platform's
 * function timeout — 60 seconds on the Vercel Hobby plan — and 800 words plus
 * a scene list is already a few thousand output tokens. On a plan with a
 * longer limit, set ANTHROPIC_EFFORT=medium (or high) for better scripts.
 */
const EFFORT = (process.env.ANTHROPIC_EFFORT ?? "low") as
  | "low"
  | "medium"
  | "high";

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
          effort: EFFORT,
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
      return errorResponse(
        `Die Anthropic-API antwortete mit ${err.status}. Prüfe ANTHROPIC_API_KEY und das Modell "${MODEL}".`,
        502,
      );
    }
    // eslint-disable-next-line no-console
    console.error("[/api/script]", err);
    return errorResponse("Unerwarteter Fehler bei der Skripterzeugung.", 500);
  }
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

    switch (scene.type) {
      case "iconGrid":
        if (scene.remaining > scene.total) {
          problems.push(
            `Szene ${i + 1} (iconGrid): remaining (${scene.remaining}) ist größer als total (${scene.total}).`,
          );
        }
        if (scene.total < 1 || scene.total > 64) {
          problems.push(
            `Szene ${i + 1} (iconGrid): total muss zwischen 1 und 64 liegen, ist aber ${scene.total}.`,
          );
        }
        break;
      case "chain":
        if (scene.breakAt < 0 || scene.breakAt >= scene.nodes.length) {
          problems.push(
            `Szene ${i + 1} (chain): breakAt (${scene.breakAt}) liegt außerhalb der ${scene.nodes.length} Knoten.`,
          );
        }
        break;
      case "chart":
        if (scene.series.length !== scene.labels.length) {
          problems.push(
            `Szene ${i + 1} (chart): ${scene.series.length} Werte, aber ${scene.labels.length} Beschriftungen.`,
          );
        }
        break;
      case "pillars":
        if (
          scene.unstableIndex < 0 ||
          scene.unstableIndex >= scene.pillars.length
        ) {
          problems.push(
            `Szene ${i + 1} (pillars): unstableIndex (${scene.unstableIndex}) liegt außerhalb der ${scene.pillars.length} Säulen.`,
          );
        }
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
