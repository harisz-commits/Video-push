import { renderMediaOnVercel } from "@remotion/vercel";
import { errorResponse, guard } from "../../../lib/guardrails";
import {
  AnyProject,
  compositionFor,
  renderBlockedReason,
  totalFramesOf,
} from "../../../lib/formats";
import { attachRender, PROJECT_ID, renderBlobPath } from "../../../lib/projects";
import {
  BLOB_ACCESS,
  progressPath,
  resolveBlobToken,
  writeJson,
  type RenderJob,
} from "../../../lib/store";
import { restoreSnapshot } from "./restore-snapshot";
import { planSegments, startSegments } from "./segments";

export const runtime = "nodejs";
/**
 * Only long enough to boot a sandbox and hand it the job. The render itself
 * runs detached and is not on this clock — which it used to be, and which is
 * why a six-minute video froze at 38% when the function was killed at 300
 * seconds while the progress document kept claiming "rendering" forever.
 */
export const maxDuration = 120;

export async function POST(req: Request) {
  const blob = resolveBlobToken();
  if (!blob) {
    return errorResponse(
      "Kein Blob-Store verbunden. Auf vercel.com unter Storage einen Blob-Store anlegen, diesem Projekt zuweisen und neu deployen.",
      500,
    );
  }

  let project: AnyProject;
  let projectId: string | undefined;
  try {
    const body = (await req.json()) as { project?: unknown; projectId?: unknown };
    project = AnyProject.parse(body.project);
    // Optional, and the difference between a video that can be found again and
    // one that cannot. Taken at the start rather than reported at the end,
    // because the end is precisely when nobody may be listening.
    if (typeof body.projectId === "string" && PROJECT_ID.test(body.projectId)) {
      projectId = body.projectId;
    }
  } catch {
    return errorResponse(
      "Ungültiges Projekt. Erwartet wird ein Infographics- oder Quiz-Projekt.",
      400,
    );
  }

  // What blocks a render differs by format, and only the format knows: an
  // infographics film without audio renders silently on guessed timings, which
  // is the most expensive way to discover a missing voiceover. A quiz has no
  // such dependency — its clock is not the voice — so it is renderable as soon
  // as it has questions.
  const blocked = renderBlockedReason(project);
  if (blocked) return errorResponse(blocked, 400);

  const allowed = await guard(req, "render", 2);
  if (!allowed.ok) return errorResponse(allowed.error, allowed.status);

  const renderId = `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const totalFrames = totalFramesOf(project);

  try {
    // Long videos are rendered in pieces, because one sandbox cannot finish
    // them: it is capped near forty-five minutes and this renderer manages
    // about three frames a second. See ./segments.ts for the measurements.
    const ranges = planSegments(totalFrames);
    if (ranges.length > 0) {
      const { segments, lifetimeMs } = await startSegments({
        renderId,
        project,
        ranges,
        blobToken: blob.value,
      });

      const job: RenderJob = {
        renderId,
        // The first piece stands in wherever a single sandbox id is expected;
        // everything that matters for a sectioned render reads `segments`.
        sandboxId: segments[0].sandboxId,
        cmdId: segments[0].cmdId,
        totalFrames,
        startedAt: Date.now(),
        lifetimeMs,
        segments,
        stage: "segments",
      };
      await writeJson(progressPath(renderId), job);

      if (projectId) {
        await attachRender(projectId, { renderId, at: Date.now() }).catch(
          () => undefined,
        );
      }

      return Response.json({
        renderId,
        totalFrames,
        durationSeconds: totalFrames / project.fps,
        segments: segments.length,
      });
    }

    const { sandbox, lifetimeMs } = await restoreSnapshot();

    // Detached: the sandbox renders and uploads on its own, so nothing here
    // has to stay alive for the twenty minutes a long video can take. The
    // sandbox is deliberately NOT stopped — stopping it would kill the render.
    const { sandboxId, cmdId } = await renderMediaOnVercel({
      sandbox,
      detached: true,
      compositionId: compositionFor(project),
      inputProps: { project },
      // Remotion's default lands near 8.4 Mbit/s, which for a film of drawn
      // stills with slow drifts is roughly four times what it needs: two
      // minutes came out at 135 MB, sixteen minutes at a gigabyte. Between two
      // frames of this format almost nothing changes, so a higher CRF costs
      // very little visibly and divides the file by four or five — which the
      // download, the storage and every later step all feel.
      crf: 24,
      vercelBlob: {
        blobToken: blob.value,
        access: BLOB_ACCESS,
        blobPath: renderBlobPath(renderId),
      },
    });

    const job: RenderJob = {
      renderId,
      sandboxId,
      cmdId,
      totalFrames,
      startedAt: Date.now(),
      lifetimeMs,
    };
    await writeJson(progressPath(renderId), job);

    // Noted on the project now, while there is certainly somebody here to note
    // it. Whether it finishes is answered later by looking for the file.
    if (projectId) {
      await attachRender(projectId, { renderId, at: Date.now() }).catch(() => {
        // A render that cannot be filed is still a render worth starting.
      });
    }

    return Response.json({
      renderId,
      totalFrames,
      durationSeconds: totalFrames / project.fps,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[/api/render]", err);
    return errorResponse(sandboxErrorDetail(err), 500);
  }
}

/**
 * The Sandbox API answers a rejected request with "Status code 400 is not ok"
 * and puts the reason in the body. Reporting only the status turned a specific
 * complaint into two deploys of guessing, so the body comes along.
 */
function sandboxErrorDetail(err: unknown): string {
  if (!(err instanceof Error)) {
    return "Der Render konnte nicht gestartet werden.";
  }
  const carrier = err as Error & {
    text?: unknown;
    json?: unknown;
    cause?: { text?: unknown; json?: unknown };
  };
  const body =
    carrier.text ??
    carrier.cause?.text ??
    carrier.json ??
    carrier.cause?.json;
  const detail =
    typeof body === "string"
      ? body
      : body
        ? JSON.stringify(body)
        : "";
  return `${err.message}${detail ? ` — ${detail}` : ""}`.slice(0, 500);
}
