import { getRenderProgress } from "@remotion/vercel";
import { clientKey, errorResponse, rateLimit } from "../../../lib/guardrails";
import {
  progressPath,
  readJson,
  type RenderJob,
  type RenderProgress,
} from "../../../lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Asks the sandbox how far it is, rather than reporting a copy.
 *
 * The previous version served a document that the render function wrote as it
 * went. When that function was killed — which it always was, on any video long
 * enough to matter — the document froze at its last value and the studio spun
 * forever on "rendering". The sandbox is the only thing that actually knows.
 */
export async function GET(req: Request) {
  const renderId = new URL(req.url).searchParams.get("renderId");
  if (!renderId || !/^[a-zA-Z0-9_-]{6,64}$/.test(renderId)) {
    return errorResponse("Ungültige oder fehlende renderId.", 400);
  }

  const limited = rateLimit(clientKey(req, "progress"), 120, 60_000);
  if (!limited.ok) return errorResponse(limited.error, limited.status);

  const job = await readJson<RenderJob>(progressPath(renderId));
  if (!job) {
    return errorResponse(
      "Zu dieser renderId gibt es keinen Render. Entweder ist er noch nicht gestartet oder er ist älter als die Aufbewahrungsfrist.",
      404,
    );
  }

  const base = {
    renderId,
    startedAt: job.startedAt,
    updatedAt: Date.now(),
  };

  try {
    const p = await getRenderProgress({
      sandboxId: job.sandboxId,
      cmdId: job.cmdId,
    });

    switch (p.stage) {
      case "starting":
        return Response.json({
          ...base,
          status: "queued",
          progress: 0,
          phase: "Sandbox wird gestartet",
        } satisfies RenderProgress);
      case "opening-browser":
        return Response.json({
          ...base,
          status: "rendering",
          progress: p.overallProgress,
          phase: "Browser wird geöffnet",
        } satisfies RenderProgress);
      case "selecting-composition":
        return Response.json({
          ...base,
          status: "rendering",
          progress: p.overallProgress,
          phase: "Komposition wird gewählt",
        } satisfies RenderProgress);
      case "render-progress":
        return Response.json({
          ...base,
          status: "rendering",
          progress: p.overallProgress,
          phase: `Rendert ${Math.round(p.overallProgress * job.totalFrames)} von ${job.totalFrames} Frames`,
        } satisfies RenderProgress);
      case "uploading":
        return Response.json({
          ...base,
          status: "rendering",
          progress: p.overallProgress,
          phase: "Video wird hochgeladen",
        } satisfies RenderProgress);
      case "done":
        return Response.json({
          ...base,
          status: "done",
          progress: 1,
          phase: "Gerendert",
          outputUrl: p.url,
          sizeBytes: p.size,
        } satisfies RenderProgress);
      case "error":
        return Response.json({
          ...base,
          status: "error",
          progress: 0,
          phase: "Abgebrochen",
          error: describeRenderError(p),
        } satisfies RenderProgress);
      default:
        return Response.json({
          ...base,
          status: "rendering",
          progress: 0,
          phase: "Läuft",
        } satisfies RenderProgress);
    }
  } catch (err) {
    // A sandbox that has expired or been reclaimed cannot be asked any more.
    // Saying so beats leaving the studio to spin.
    // eslint-disable-next-line no-console
    console.error("[/api/progress]", err);
    return Response.json({
      ...base,
      status: "error",
      progress: 0,
      phase: "Abgebrochen",
      error: expired(job)
        ? `Die Sandbox lief nach ${Math.round(job.lifetimeMs / 60000)} Minuten ab, bevor das Video fertig war. Das ist die Obergrenze, die dieser Vercel-Account für eine Sandbox erlaubt — ein Video dieser Länge passt nicht hinein. Kürzeres Skript oder ein Render-Host ohne dieses Limit.`
        : "Der Render ist nicht mehr erreichbar. Die Sandbox wurde beendet, bevor das Video fertig war. Starte den Render erneut.",
    } satisfies RenderProgress);
  }
}

/** True once the sandbox has certainly outlived its granted lifetime. */
function expired(job: RenderJob): boolean {
  return Date.now() - job.startedAt > job.lifetimeMs;
}

function describeRenderError(stage: { stage: "error" } & Record<string, unknown>): string {
  const message = stage.message ?? stage.error;
  return typeof message === "string" && message
    ? message.slice(0, 400)
    : "Der Render ist fehlgeschlagen.";
}
