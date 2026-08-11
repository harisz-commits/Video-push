import {
  clientKey,
  errorResponse,
  rateLimit,
} from "../../../../lib/guardrails";
import { listScriptHistory } from "../../../../lib/projects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Scripts that were generated but never saved as a project.
 *
 * Only worth anything for as long as the job documents survive the thirty-day
 * sweep, which is exactly why this exists: without a way to see them, work
 * that cost real money expires unnoticed and the only way back to a script is
 * to pay for a different one.
 */
export async function GET(req: Request) {
  const limited = rateLimit(clientKey(req, "script-history"), 60, 60_000);
  if (!limited.ok) return errorResponse(limited.error, limited.status);

  try {
    return Response.json({ scripts: await listScriptHistory() });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[/api/script/history]", err);
    return errorResponse(
      "Die früheren Skripte konnten nicht gelesen werden.",
      500,
    );
  }
}
