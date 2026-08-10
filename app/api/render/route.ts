import { renderMediaOnVercel } from "@remotion/vercel";
import { resolveSceneTimings } from "../../../lib/align";
import { COMP_NAME } from "../../../lib/constants";
import { errorResponse, guard } from "../../../lib/guardrails";
import { RenderRequest, type VideoProject } from "../../../lib/schema";
import {
  BLOB_ACCESS,
  progressPath,
  resolveBlobToken,
  writeJson,
  type RenderJob,
} from "../../../lib/store";
import { restoreSnapshot } from "./restore-snapshot";

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

  let project: VideoProject;
  try {
    project = RenderRequest.parse(await req.json()).project;
  } catch {
    return errorResponse(
      "Ungültiges Projekt. Erwartet wird { project: VideoProject }.",
      400,
    );
  }

  // Rendering without audio would produce a silent video on an estimated
  // timeline — never what anyone wants, and the most expensive way to find out.
  if (!project.audioUrl || !project.alignment) {
    return errorResponse(
      "Für diesen Render fehlt das Voiceover. Erzeuge zuerst die Stimme — die Szenenzeiten kommen aus den Timestamps.",
      400,
    );
  }

  const allowed = await guard(req, "render", 2);
  if (!allowed.ok) return errorResponse(allowed.error, allowed.status);

  const renderId = `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const timing = resolveSceneTimings(project);

  try {
    const sandbox = await restoreSnapshot();

    // Detached: the sandbox renders and uploads on its own, so nothing here
    // has to stay alive for the twenty minutes a long video can take. The
    // sandbox is deliberately NOT stopped — stopping it would kill the render.
    const { sandboxId, cmdId } = await renderMediaOnVercel({
      sandbox,
      detached: true,
      compositionId: COMP_NAME,
      inputProps: { project },
      vercelBlob: {
        blobToken: blob.value,
        access: BLOB_ACCESS,
        blobPath: `renders/${renderId}.mp4`,
      },
    });

    const job: RenderJob = {
      renderId,
      sandboxId,
      cmdId,
      totalFrames: timing.totalFrames,
      startedAt: Date.now(),
    };
    await writeJson(progressPath(renderId), job);

    return Response.json({
      renderId,
      totalFrames: timing.totalFrames,
      durationSeconds: timing.totalFrames / project.fps,
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
