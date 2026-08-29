import { waitUntil } from "@vercel/functions";
import { errorResponse, guard } from "../../../lib/guardrails";
import { keyFor, keyNameFor } from "../../../lib/llm";
import {
  DEFAULT_FINANCE_MODEL,
  generateFinance,
  importFinanceScript,
} from "../../../lib/finance-pipeline";
import { FinanceFormat } from "../../../lib/finance";
import { resolveTextModel, type TextModel } from "../../../lib/text-models";
import {
  storyJobPath,
  readJson,
  writeJson,
  type StoryJob,
} from "../../../lib/store";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Ein Finanzvideo schreiben.
 *
 * Weit weniger Stellschrauben als /api/story, und das ist kein Rückstand,
 * sondern der Punkt des Formats: kein Bildstil, kein Bildbudget, keine
 * Bilder pro Minute, keine Figuren — es wird nichts gezeichnet, also gibt es
 * nichts zu budgetieren. Übrig bleiben Thema, Länge, Modell und die Frage,
 * ob vorher recherchiert wird.
 *
 * Derselbe Auftragsspeicher wie das Video-Format, weil das Ergebnis dasselbe
 * ist: ein StoryProject, das das Studio abholt.
 */
export async function POST(req: Request) {
  let topic: string;
  let script: string | undefined;
  let minutes: number;
  let research: boolean;
  let format: FinanceFormat;
  let model: TextModel;
  try {
    const body = (await req.json()) as {
      topic?: unknown;
      script?: unknown;
      minutes?: unknown;
      research?: unknown;
      format?: unknown;
      model?: unknown;
    };
    // Ein eingefügtes Skript ersetzt das Thema: dann wird nichts geschrieben,
    // sondern nur bebildert. Siehe importFinanceScript().
    script =
      typeof body.script === "string" && body.script.trim().length > 40
        ? body.script.trim().slice(0, 60_000)
        : undefined;
    if (
      !script &&
      (typeof body.topic !== "string" || body.topic.trim().length < 3)
    ) {
      throw new Error("topic");
    }
    topic =
      typeof body.topic === "string" ? body.topic.trim().slice(0, 2000) : "";
    minutes = Math.min(25, Math.max(1, Number(body.minutes) || 6));
    // An bei fehlender Angabe. Bei Finanzinhalten ist ein aus dem Gedächtnis
    // geschriebenes Skript nicht bloß ungenau — es steht als Zahl im Bild,
    // mit einer Quellenzeile darunter.
    research = body.research !== false;
    // Unbekanntes fällt auf „Der Fehler" zurück: das Format trägt jedes
    // Finanzthema, und ein Video, das aus einem Tippfehler entsteht, soll
    // eines sein und keine Fehlermeldung.
    format = FinanceFormat.safeParse(body.format).data ?? "fehler";
    model = resolveTextModel(
      typeof body.model === "string" ? body.model : DEFAULT_FINANCE_MODEL,
    );
  } catch {
    return errorResponse(
      "Ungültige Anfrage. Erwartet wird { topic: string, minutes?: number }.",
      400,
    );
  }

  const apiKey = keyFor(model);
  if (!apiKey) {
    return errorResponse(
      `${keyNameFor(model)} ist nicht gesetzt — ${model.label} lässt sich ohne diesen Key nicht aufrufen.`,
      500,
    );
  }

  const allowed = await guard(req, "script", 4);
  if (!allowed.ok) return errorResponse(allowed.error, allowed.status);

  const jobId = `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const startedAt = Date.now();

  await writeJson(storyJobPath(jobId), {
    jobId,
    topic,
    status: "running",
    startedAt,
    updatedAt: startedAt,
  } satisfies StoryJob);

  if (script) {
    waitUntil(importFinanceScript({ jobId, script, apiKey, model, startedAt }));
    return Response.json({ jobId });
  }

  waitUntil(
    generateFinance({
      jobId,
      topic,
      minutes,
      research,
      format,
      apiKey,
      model,
      startedAt,
    }),
  );

  return Response.json({ jobId });
}

export async function GET(req: Request) {
  const jobId = new URL(req.url).searchParams.get("jobId");
  if (!jobId || !/^[a-zA-Z0-9_-]{6,64}$/.test(jobId)) {
    return errorResponse("Ungültige oder fehlende jobId.", 400);
  }

  const job = await readJson<StoryJob>(storyJobPath(jobId));
  if (!job)
    return errorResponse("Zu dieser jobId gibt es keinen Auftrag.", 404);

  if (
    job.status === "running" &&
    Date.now() - job.startedAt > (maxDuration + 30) * 1000
  ) {
    return Response.json({
      ...job,
      status: "error",
      error: "Der Auftrag hat das Zeitlimit überschritten.",
    } satisfies StoryJob);
  }
  return Response.json(job);
}
