import {
  clientKey,
  errorResponse,
  rateLimit,
} from "../../../../lib/guardrails";
import {
  deleteProject,
  PROJECT_ID,
  readProject,
  reconcileRenders,
  saveProject,
} from "../../../../lib/projects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/** One project, in full — this is what "load" fetches. */
export async function GET(req: Request, { params }: Context) {
  const { id } = await params;
  if (!PROJECT_ID.test(id)) return errorResponse("Ungültige Projekt-Id.", 400);

  const limited = rateLimit(clientKey(req, "project"), 120, 60_000);
  if (!limited.ok) return errorResponse(limited.error, limited.status);

  const record = await readProject(id);
  if (!record) return errorResponse("Dieses Projekt gibt es nicht.", 404);

  // Opening a project is exactly when someone wants to know whether the render
  // they walked away from finished, so this is where we go and look.
  const { record: fresh, changed } = await reconcileRenders(record);
  if (changed) await saveProject(fresh).catch(() => undefined);

  return Response.json(fresh);
}

export async function DELETE(req: Request, { params }: Context) {
  const { id } = await params;
  if (!PROJECT_ID.test(id)) return errorResponse("Ungültige Projekt-Id.", 400);

  const limited = rateLimit(clientKey(req, "project-delete"), 30, 60_000);
  if (!limited.ok) return errorResponse(limited.error, limited.status);

  // The audio and the rendered video are deliberately left alone. They are
  // keyed by their own ids, cost nothing to keep for the sweep's thirty days,
  // and deleting a project by accident should not also destroy the one
  // expensive artefact that could still be recovered from a URL.
  await deleteProject(id);
  return Response.json({ ok: true });
}
