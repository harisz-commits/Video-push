import { errorResponse, guard } from "../../../../lib/guardrails";
import { keyFor, keyNameFor } from "../../../../lib/llm";
import { DEFAULT_YOUTUBE_MODEL, StoryProject } from "../../../../lib/story";
import { writeListing } from "../../../../lib/story-youtube";
import { costCents, resolveTextModel } from "../../../../lib/text-models";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Der Text fürs Upload-Formular.
 *
 * Ohne Hintergrundauftrag, anders als alles andere in diesem Studio: eine
 * Zusammenfassung von etwas, das schon geschrieben ist, dauert mit einem
 * Lite-Modell wenige Sekunden. Ein Auftrag mit Blob-Datei und Abfrage wäre
 * mehr Zustand als die Sache wert ist — und Zustand ist hier schon zweimal
 * die Fehlerquelle gewesen.
 */
export async function POST(req: Request) {
  let project: StoryProject;
  let modelId: string;
  try {
    const body = (await req.json()) as { project?: unknown; model?: unknown };
    project = StoryProject.parse(body.project);
    modelId =
      typeof body.model === "string" ? body.model : DEFAULT_YOUTUBE_MODEL;
  } catch {
    return errorResponse("Ungültige Anfrage. Erwartet wird das Video.", 400);
  }

  const model = resolveTextModel(modelId);
  const apiKey = keyFor(model);
  if (!apiKey) {
    return errorResponse(
      `${keyNameFor(model)} ist nicht gesetzt — ${model.label} lässt sich ohne diesen Key nicht aufrufen.`,
      500,
    );
  }

  const allowed = await guard(req, "script", 4);
  if (!allowed.ok) return errorResponse(allowed.error, allowed.status);

  try {
    const { listing, usage } = await writeListing({ project, model, apiKey });
    return Response.json({
      listing: {
        ...listing,
        title: listing.titles[0],
        model: model.id,
      },
      cents: costCents(model, usage),
    });
  } catch (err) {
    return errorResponse((err as Error).message.slice(0, 400), 502);
  }
}
