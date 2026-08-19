import { getRenderProgress } from "@remotion/vercel";
import { waitUntil } from "@vercel/functions";
import { clientKey, errorResponse, rateLimit } from "../../../lib/guardrails";
import { stopSandbox } from "../../../lib/sandboxes";
import {
  progressPath,
  readJson,
  resolveBlobToken,
  writeJson,
  type RenderJob,
  type RenderProgress,
} from "../../../lib/store";
import { renderBlobPath } from "../../../lib/projects";
import { startStitch } from "../render/segments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/**
 * Long enough to join the pieces of a sectioned render.
 *
 * The join itself is a stream copy, but the pieces have to be pulled into a
 * sandbox first, and half a gigabyte takes a while. It runs detached from the
 * response either way; this is only the ceiling on that background work.
 */
export const maxDuration = 300;

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

  let job = await readJson<RenderJob>(progressPath(renderId));
  if (!job) {
    return errorResponse(
      "Zu dieser renderId gibt es keinen Render. Entweder ist er noch nicht gestartet oder er ist älter als die Aufbewahrungsfrist.",
      404,
    );
  }

  /**
   * Try the join again, keeping the pieces.
   *
   * Rendering nine pieces takes twelve minutes and they survive in storage; a
   * join that failed for its own reasons should not cost them. Explicit rather
   * than automatic, because a join that fails on every attempt would otherwise
   * loop forever — which is exactly how the first broken one behaved.
   */
  if (
    new URL(req.url).searchParams.get("retry") === "1" &&
    job.segments &&
    (job.stitchError || job.stage === "stitching")
  ) {
    job = {
      ...job,
      stage: "segments",
      stitchError: undefined,
      stitch: undefined,
    };
    await writeJson(progressPath(renderId), job).catch(() => undefined);
  }

  const base = {
    renderId,
    startedAt: job.startedAt,
    updatedAt: Date.now(),
  };

  // A sectioned render answers from several sandboxes at once, and its
  // progress is their sum. See app/api/render/segments.ts.
  if (job.segments && job.segments.length > 0) {
    return sectioned(job, base);
  }

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


/**
 * How far a render in pieces has got.
 *
 * Every piece is asked separately and the answers are added up, so the bar
 * moves for the whole film rather than for whichever sandbox happens to be
 * furthest along. Once every piece has produced a file, one more sandbox joins
 * them — started here, in the background, because there is no other moment
 * when somebody is certainly looking.
 */
async function sectioned(
  job: RenderJob,
  base: { renderId: string; startedAt: number; updatedAt: number },
): Promise<Response> {
  const segments = job.segments ?? [];

  // Already joined: the answer is the finished file, looked up where every
  // finished render is looked up rather than remembered separately.
  if (job.stage === "done") {
    const token = resolveBlobToken()?.value;
    const file = token
      ? await import("@vercel/blob")
          .then((m) => m.head(renderBlobPath(job.renderId), { token }))
          .catch(() => null)
      : null;
    return Response.json({
      ...base,
      status: "done",
      progress: 1,
      phase: "Gerendert",
      outputUrl: file?.downloadUrl ?? file?.url,
      sizeBytes: file?.size,
    } satisfies RenderProgress);
  }

  const states = await Promise.all(
    segments.map(async (segment) => {
      if (segment.url) {
        return { segment, stage: "done", progress: 1, url: segment.url };
      }
      try {
        const p = await getRenderProgress({
          sandboxId: segment.sandboxId,
          cmdId: segment.cmdId,
        });
        return {
          segment,
          // Normalised, because a sandbox that no longer exists does not make
          // this call throw — it answers with an object that has no stage at
          // all. Left as undefined, such a piece was neither finished nor
          // failed nor unreachable, so nine dead sandboxes reported themselves
          // as nine running ones, forever.
          stage: ((p as { stage?: string }).stage ?? "unbekannt") as string,
          // `overallProgress`, not `progress`. The latter exists too, but at
          // the render-progress stage it is a nested object rather than a
          // number — so reading it reported every piece as 0 % right up to
          // the moment it finished.
          // "expired" is the one stage that carries no progress at all.
          progress:
            p.stage === "done"
              ? 1
              : p.stage === "expired"
                ? 0
                : (p.overallProgress ?? 0),
          url: p.stage === "done" ? p.url : undefined,
        };
      } catch {
        return { segment, stage: "unreachable", progress: 0, url: undefined };
      }
    }),
  );

  /**
   * A piece is finished if its FILE exists, whatever its sandbox says.
   *
   * The sandbox is reclaimed some minutes after it finishes, and from then on
   * it answers with no stage at all — so a render whose pieces were all
   * rendered and uploaded looked, an hour later, exactly like one whose
   * pieces had died. The upload is the fact that matters and it is durable;
   * the sandbox is not.
   */
  const token0 = resolveBlobToken()?.value;
  if (token0) {
    const { head } = await import("@vercel/blob");
    await Promise.all(
      states.map(async (state) => {
        if (state.stage === "done" || state.url) return;
        const meta = await head(state.segment.path, { token: token0 }).catch(
          () => null,
        );
        if (meta) {
          state.stage = "done";
          state.progress = 1;
          state.url = meta.url;
        }
      }),
    );
  }

  const finished = states.filter((s) => s.stage === "done");
  // "expired" is Remotion's word for a sandbox that outlived its lease with
  // the render unfinished. Treated as a failure, because that is what it is.
  const failed = states.filter(
    (s) => s.stage === "error" || s.stage === "expired",
  );

  if (failed.length > 0) {
    return Response.json({
      ...base,
      status: "error",
      progress: 0,
      phase: "Abgebrochen",
        error: `${failed.length} von ${segments.length} Teilen sind fehlgeschlagen (${[...new Set(failed.map((f) => f.stage))].join(", ")}). ${finished.length} waren fertig. Starte den Render neu.`,
    } satisfies RenderProgress);
  }

  const done = states.reduce((sum, s) => sum + s.progress, 0) / segments.length;
  const parts = states.map((s) => ({
    index: s.segment.index,
    stage: s.stage,
    progress: Number(s.progress.toFixed(3)),
  }));

  /**
   * Every piece out of reach, long after they should have started.
   *
   * A sandbox that cannot be asked has either finished and been reclaimed or
   * died — and if it had finished it would have left a file, which the check
   * above would have found. So this is death, and reporting it as "still
   * rendering" is how a dead render sits at zero per cent forever.
   */
  const unreachable = states.filter(
    (s) => s.stage === "unreachable" || s.stage === "unbekannt",
  ).length;
  if (unreachable === segments.length && Date.now() - job.startedAt > 120_000) {
    return Response.json({
      ...base,
      status: "error",
      progress: 0,
      phase: "Abgebrochen",
      parts,
      error: `Keines der ${segments.length} Teile ist noch erreichbar und keines hat eine Datei hinterlassen. Die Sandboxes sind beendet worden, bevor sie fertig waren. Starte den Render neu.`,
    } satisfies RenderProgress);
  }

  // A join that already failed is not retried on every poll. Trying again
  // every four seconds would hide the reason behind a wall of identical
  // failures and pull nine files down again each time.
  if (job.stitchError) {
    return Response.json({
      ...base,
      status: "error",
      progress: 0.95,
      phase: "Verbinden fehlgeschlagen",
      parts,
      error: `Alle ${segments.length} Teile sind gerendert, aber das Zusammenfügen ist gescheitert: ${job.stitchError}`,
    } satisfies RenderProgress);
  }

  const token = resolveBlobToken()?.value;

  // Joining, started earlier. The finished file is the only signal worth
  // trusting — the sandbox doing the work is reclaimed shortly after it
  // succeeds, so its silence means nothing either way.
  if (job.stage === "stitching") {
    if (token) {
      const { head } = await import("@vercel/blob");
      const file = await head(renderBlobPath(job.renderId), { token }).catch(
        () => null,
      );
      if (file) {
        await writeJson(progressPath(job.renderId), {
          ...job,
          stage: "done",
        } satisfies RenderJob).catch(() => undefined);
        return Response.json({
          ...base,
          status: "done",
          progress: 1,
          phase: "Gerendert",
          outputUrl: file.downloadUrl ?? file.url,
          sizeBytes: file.size,
        } satisfies RenderProgress);
      }
    }

    // A sandbox is reclaimed near forty-five minutes, so a join still running
    // past thirty is not slow — it is a zombie. Its command still answers when
    // asked and will never report an exit code, which is precisely how one sat
    // at "Teile werden verbunden" for four hours.
    //
    // Reported in the same response that records it, not on the next poll: the
    // previous version wrote the reason and then answered "läuft noch" anyway,
    // so it took a second request to tell anyone — and if nobody polled twice,
    // never.
    const stitchingFor = Date.now() - (job.stitch?.startedAt ?? job.startedAt);
    if (stitchingFor > 30 * 60_000) {
      const reason = `Das Verbinden lief ${Math.round(stitchingFor / 60000)} Minuten ohne Ergebnis. Die Sandbox wird nach etwa 45 Minuten eingesammelt; der Befehl läuft ins Leere.`;
      await writeJson(progressPath(job.renderId), {
        ...job,
        stitchError: reason,
      } satisfies RenderJob).catch(() => undefined);
      return Response.json({
        ...base,
        status: "error",
        progress: 0.95,
        phase: "Verbinden fehlgeschlagen",
        parts,
        error: `Alle ${segments.length} Teile sind gerendert, aber das Zusammenfügen ist gescheitert: ${reason}`,
      } satisfies RenderProgress);
    }

    return Response.json({
      ...base,
      status: "rendering",
      progress: 0.97,
      phase: `Teile werden verbunden (${Math.round(stitchingFor / 1000)} s)`,
      parts,
    } satisfies RenderProgress);
  }

  // Every piece finished and nothing is joining them yet.
  if (finished.length === segments.length && token) {
    const withUrls = states.map((s) => ({
      ...s.segment,
      url: s.url ?? s.segment.url,
    }));
    try {
      const stitch = await startStitch({
        renderId: job.renderId,
        segments: withUrls,
        blobToken: token,
      });
      await writeJson(progressPath(job.renderId), {
        ...job,
        segments: withUrls,
        stage: "stitching",
        stitch: { ...stitch, startedAt: Date.now() },
      } satisfies RenderJob);
      return Response.json({
        ...base,
        status: "rendering",
        progress: 0.96,
        phase: "Teile werden verbunden (0 s)",
        parts,
      } satisfies RenderProgress);
    } catch (err) {
      await writeJson(progressPath(job.renderId), {
        ...job,
        segments: withUrls,
        stitchError: (err as Error).message.slice(0, 400),
      } satisfies RenderJob).catch(() => undefined);
    }
  }

  return Response.json({
    ...base,
    status: "rendering",
    parts,
    progress: done * 0.95,
    phase: `${finished.length} von ${segments.length} Teilen fertig — ${Math.round(done * 100)} %`,
  } satisfies RenderProgress);
}
