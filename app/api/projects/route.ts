import { clientKey, errorResponse, rateLimit } from "../../../lib/guardrails";
import {
  listProjects,
  newProjectId,
  PROJECT_ID,
  readProject,
  saveProject,
  summarize,
  type ProjectRecord,
} from "../../../lib/projects";
import { AnyProject } from "../../../lib/formats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The saved projects, newest first. */
export async function GET(req: Request) {
  const limited = rateLimit(clientKey(req, "projects"), 120, 60_000);
  if (!limited.ok) return errorResponse(limited.error, limited.status);

  try {
    return Response.json({ projects: await listProjects() });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[/api/projects]", err);
    return errorResponse(
      "Die gespeicherten Projekte konnten nicht gelesen werden.",
      500,
    );
  }
}

/**
 * Create or update a project.
 *
 * One route for both, because the studio does not distinguish: it saves what it
 * has whenever something changes, and whether that key existed yet is the
 * server's business. An id that is absent gets minted; an id that is present
 * overwrites, which is what an autosave means.
 */
export async function POST(req: Request) {
  const limited = rateLimit(clientKey(req, "projects-write"), 120, 60_000);
  if (!limited.ok) return errorResponse(limited.error, limited.status);

  let body: {
    id?: string;
    title?: string;
    project?: unknown;
    research?: string;
    lastRender?: ProjectRecord["lastRender"];
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return errorResponse("Ungültige Anfrage.", 400);
  }

  const parsed = AnyProject.safeParse(body.project);
  if (!parsed.success) {
    return errorResponse(
      "Das Projekt hat nicht die erwartete Form und wurde nicht gespeichert.",
      400,
    );
  }
  if (body.id && !PROJECT_ID.test(body.id)) {
    return errorResponse("Ungültige Projekt-Id.", 400);
  }

  const id = body.id ?? newProjectId();
  const now = Date.now();

  try {
    // Read first so an update keeps what the caller did not send — the
    // research notes and the last render belong to the project, not to
    // whichever screen happened to save it.
    const existing = body.id ? await readProject(body.id) : null;

    const record: ProjectRecord = {
      id,
      title:
        body.title?.trim() ||
        existing?.title ||
        parsed.data.title ||
        parsed.data.topic ||
        "Unbenannt",
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      project: parsed.data,
      research: body.research ?? existing?.research,
      lastRender: body.lastRender ?? existing?.lastRender,
    };

    await saveProject(record);
    return Response.json({ project: summarize(record), id });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[/api/projects POST]", err);
    return errorResponse("Das Projekt konnte nicht gespeichert werden.", 500);
  }
}
