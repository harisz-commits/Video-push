import { getRenderProgress } from "@remotion/vercel";
import { waitUntil } from "@vercel/functions";
import { clientKey, errorResponse, rateLimit } from "../../../lib/guardrails";
import { stopSandbox } from "../../../lib/sandboxes";
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
        // The render is off the machine and in Blob storage; the machine is
        // now pure cost.
        //
        // This was `void stopSandbox(...)` — fire and forget — and it never
        // fired: the response returns, the instance is frozen, and the promise
        // is dropped before the API call goes out. Measured after an
        // eight-second render, the sandbox was still running four and a half
        // minutes later and only stopped when its lease ran out. `waitUntil`
        // is what keeps the instance alive for work that outlives the answer,
        // and the answer still does not wait on it.
        waitUntil(stopSandbox(job.sandboxId));
        return Response.json({
          ...base,
          status: "done",
          progress: 1,
          phase: "Gerendert",
          outputUrl: p.url,
          sizeBytes: p.size,
        } satisfies RenderProgress);
      case "error":
        waitUntil(stopSandbox(job.sandboxId));
        return Response.json({
          ...base,
          status: "error",
          progress: 0,
          phase: "Abgebrochen",
          error: describeRenderError(p),
        } satisfies RenderProgress);
      default: {
        // An unrecognised stage used to be reported as "running, 0%", which is
        // indistinguishable from a render that has silently died — and that is
        // exactly what it usually is. Name the stage, and once the job has
        // outlived the sandbox there is nothing left to wait for.
        const stage = (p as { stage?: string }).stage ?? "unbekannt";
        if (expired(job)) {
          // This branch used to report the render as lost and leave the
          // machine alone, on the belief that an expired lease had already
          // taken it. It had not — sandboxes outlive their lease indefinitely
          // when nothing stops them. Giving up on the render and giving up on
          // the machine have to happen together.
          waitUntil(stopSandbox(job.sandboxId));
          return Response.json({
            ...base,
            status: "error",
            progress: 0,
            phase: "Abgebrochen",
            error: `Die Sandbox meldet seit ${Math.round(
              (Date.now() - job.startedAt) / 60000,
            )} Minuten den Zustand "${stage}" und hat ihre Laufzeit von ${Math.round(
              job.lifetimeMs / 60000,
            )} Minuten überschritten. Der Render läuft nicht mehr — starte ihn neu.`,
          } satisfies RenderProgress);
        }
        return Response.json({
          ...base,
          status: "rendering",
          progress: 0,
          phase: `Läuft (${stage})`,
        } satisfies RenderProgress);
      }
    }
  } catch (err) {
    // A sandbox that has expired or been reclaimed cannot be asked any more.
    // Saying so beats leaving the studio to spin — and if it is in fact still
    // running, unreachable is still finished as far as this render goes.
    // eslint-disable-next-line no-console
    console.error("[/api/progress]", err);
    waitUntil(stopSandbox(job.sandboxId));
    return Response.json({
      ...base,
      status: "error",
      progress: 0,
      phase: "Abgebrochen",
      error: expired(job)
        ? `Der Render hat die ${Math.round(job.lifetimeMs / 60000)} Minuten überschritten, die eine wiederhergestellte Sandbox laufen darf, und ist abgebrochen worden. Diese Grenze lässt sich nicht verlängern — ein Video dieser Länge passt nicht hinein. Kürzeres Skript oder ein Render-Host ohne dieses Limit.`
        : "Der Render ist nicht mehr erreichbar. Die Sandbox wurde beendet, bevor das Video fertig war. Starte den Render erneut.",
    } satisfies RenderProgress);
  }
}

/**
 * True once the render has outlived the lifetime its sandbox was granted.
 *
 * Note what this does *not* say: that the sandbox has stopped. It has not —
 * a sandbox runs until something stops it, lease or no lease. This only means
 * the render can no longer be expected to finish.
 */
function expired(job: RenderJob): boolean {
  return Date.now() - job.startedAt > job.lifetimeMs;
}

function describeRenderError(stage: { stage: "error" } & Record<string, unknown>): string {
  const message = stage.message ?? stage.error;
  return typeof message === "string" && message
    ? message.slice(0, 400)
    : "Der Render ist fehlgeschlagen.";
}
