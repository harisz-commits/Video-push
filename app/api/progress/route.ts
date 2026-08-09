import { errorResponse, rateLimit, clientKey } from "../../../lib/guardrails";
import { progressPath, readJson, type RenderProgress } from "../../../lib/store";

export const runtime = "nodejs";

/**
 * Poll target for the studio's render bar.
 *
 * Reading is cheap but a stuck client could poll forever, so it carries a
 * generous rate limit of its own.
 */
export async function GET(req: Request) {
  const renderId = new URL(req.url).searchParams.get("renderId");
  if (!renderId || !/^[a-zA-Z0-9_-]{6,64}$/.test(renderId)) {
    return errorResponse("Ungültige oder fehlende renderId.", 400);
  }

  const limited = rateLimit(clientKey(req, "progress"), 120, 60_000);
  if (!limited.ok) return errorResponse(limited.error, limited.status);

  const progress = await readJson<RenderProgress>(progressPath(renderId));
  if (!progress) {
    return errorResponse(
      "Zu dieser renderId gibt es keinen Fortschritt. Entweder ist der Render noch nicht gestartet oder er ist älter als die Aufbewahrungsfrist.",
      404,
    );
  }

  return Response.json(progress);
}
