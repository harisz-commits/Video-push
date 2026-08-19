import { Sandbox } from "@vercel/sandbox";
import { errorResponse } from "../../../../lib/guardrails";
import { progressPath, readJson, type RenderJob } from "../../../../lib/store";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * What the join is actually doing.
 *
 * The stitch runs as a detached command, and until now nothing ever read its
 * output — so "Teile werden verbunden" for eleven minutes was indistinguishable
 * from a command that had failed in its first second. The command knows; it
 * was simply never asked.
 */
export async function GET(req: Request) {
  const renderId = new URL(req.url).searchParams.get("renderId");
  if (!renderId || !/^[a-zA-Z0-9_-]{6,64}$/.test(renderId)) {
    return errorResponse("Ungültige oder fehlende renderId.", 400);
  }

  const job = await readJson<RenderJob>(progressPath(renderId));
  if (!job?.stitch) {
    return errorResponse("Zu diesem Render läuft kein Verbinden.", 404);
  }

  try {
    const sandbox = await Sandbox.get({ sandboxId: job.stitch.sandboxId });
    const cmd = await sandbox.getCommand(job.stitch.cmdId);
    const [out, err] = await Promise.all([
      cmd.stdout().catch(() => ""),
      cmd.stderr().catch(() => ""),
    ]);

    return Response.json({
      renderId,
      laeuftSeitSekunden: Math.round((Date.now() - job.stitch.startedAt) / 1000),
      exitCode: (cmd as { exitCode?: number | null }).exitCode ?? null,
      stdout: out.slice(-1500),
      stderr: err.slice(-1500),
    });
  } catch (err) {
    return Response.json({
      renderId,
      laeuftSeitSekunden: Math.round((Date.now() - job.stitch.startedAt) / 1000),
      fehler: (err as Error).message.slice(0, 400),
    });
  }
}
