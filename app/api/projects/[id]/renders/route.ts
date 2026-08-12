import {
  clientKey,
  errorResponse,
  rateLimit,
} from "../../../../../lib/guardrails";
import {
  attachRender,
  PROJECT_ID,
  readProject,
  reconcileRenders,
  renderBlobPath,
  saveProject,
} from "../../../../../lib/projects";
import { head } from "@vercel/blob";
import { resolveBlobToken } from "../../../../../lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/**
 * Claim a rendered video for a project.
 *
 * Renders are filed against their project at the start now, but everything
 * rendered before that is a finished video sitting in storage with nothing
 * pointing at it. Eleven of them, in the case that prompted this. They are not
 * lost — they are unreachable, which for a video amounts to the same thing
 * except that these were paid for.
 *
 * Attribution cannot be inferred: nothing recorded which project those renders
 * belonged to, and guessing from timestamps would eventually file the wrong
 * video under the wrong project, which is worse than leaving it unfiled. So a
 * person says which is which, and this is where they say it.
 */
export async function POST(req: Request, { params }: Context) {
  const { id } = await params;
  if (!PROJECT_ID.test(id)) return errorResponse("Ungültige Projekt-Id.", 400);

  const limited = rateLimit(clientKey(req, "project-attach"), 30, 60_000);
  if (!limited.ok) return errorResponse(limited.error, limited.status);

  let renderId: string;
  try {
    const body = (await req.json()) as { renderId?: unknown };
    if (typeof body.renderId !== "string" || !/^[a-zA-Z0-9_-]{6,64}$/.test(body.renderId)) {
      throw new Error("renderId");
    }
    renderId = body.renderId;
  } catch {
    return errorResponse("Ungültige Anfrage. Erwartet wird { renderId }.", 400);
  }

  const record = await readProject(id);
  if (!record) return errorResponse("Dieses Projekt gibt es nicht.", 404);

  // Refuse to file a video that does not exist. A project listing a render
  // that was never produced is a worse lie than one listing nothing at all.
  const token = resolveBlobToken()?.value;
  if (!token) return errorResponse("Kein Blob-Store verbunden.", 500);

  let meta: Awaited<ReturnType<typeof head>>;
  try {
    meta = await head(renderBlobPath(renderId), { token });
  } catch {
    return errorResponse(
      `Zu dieser renderId liegt kein Video im Speicher (${renderId}).`,
      404,
    );
  }

  if (record.renders?.some((r) => r.renderId === renderId)) {
    return Response.json({ ok: true, already: true });
  }

  await attachRender(id, {
    renderId,
    at: new Date(meta.uploadedAt).getTime(),
    outputUrl: meta.url,
    sizeBytes: meta.size,
  });

  // Re-read and reconcile so the response reflects what the studio will see.
  const updated = await readProject(id);
  if (updated) {
    const { record: fresh, changed } = await reconcileRenders(updated);
    if (changed) await saveProject(fresh).catch(() => undefined);
    return Response.json({ ok: true, renders: fresh.renders ?? [] });
  }

  return Response.json({ ok: true });
}
