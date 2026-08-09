import {
  addBundleToSandbox,
  createSandbox,
  renderMediaOnVercel,
  uploadToVercelBlob,
} from "@remotion/vercel";
import { waitUntil } from "@vercel/functions";
import { errorResponse, guard } from "../../../lib/guardrails";
import { resolveSceneTimings } from "../../../lib/align";
import { RenderRequest, type VideoProject } from "../../../lib/schema";
import {
  progressPath,
  writeJson,
  type RenderProgress,
} from "../../../lib/store";
import { COMP_NAME } from "../../../lib/constants";
import { bundleRemotionProject } from "./helpers";
import { restoreSnapshot } from "./restore-snapshot";

export const runtime = "nodejs";
/**
 * The function stays alive for the whole render because it drives the sandbox.
 * A five-minute 1080p video needs the headroom; on Vercel Hobby the ceiling is
 * lower than this and long renders will be cut off (see README, Guardrails).
 */
export const maxDuration = 300;

export async function POST(req: Request) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return errorResponse(
      'BLOB_READ_WRITE_TOKEN fehlt. Auf vercel.com unter Storage einen Blob-Store anlegen, mit diesem Projekt verbinden und neu deployen.',
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

  const initial: RenderProgress = {
    renderId,
    status: "queued",
    progress: 0,
    phase: "Sandbox wird gestartet",
    startedAt: Date.now(),
    updatedAt: Date.now(),
  };
  await writeJson(progressPath(renderId), initial);

  waitUntil(runRender(renderId, project, timing.totalFrames));

  return Response.json({
    renderId,
    totalFrames: timing.totalFrames,
    durationSeconds: timing.totalFrames / project.fps,
  });
}

async function runRender(
  renderId: string,
  project: VideoProject,
  totalFrames: number,
): Promise<void> {
  const startedAt = Date.now();
  let lastWrite = 0;

  /** Progress writes are throttled — the UI polls, it does not need every frame. */
  const report = async (
    patch: Partial<RenderProgress>,
    force = false,
  ): Promise<void> => {
    const now = Date.now();
    if (!force && now - lastWrite < 1_000) return;
    lastWrite = now;
    await writeJson(progressPath(renderId), {
      renderId,
      status: "rendering",
      progress: 0,
      phase: "",
      startedAt,
      ...patch,
      updatedAt: now,
    } as RenderProgress).catch(() => {
      // A dropped progress write must never abort the render itself.
    });
  };

  let sandbox: Awaited<ReturnType<typeof createSandbox>> | undefined;

  try {
    sandbox = process.env.VERCEL
      ? await restoreSnapshot()
      : await createSandbox({
          onProgress: async ({ progress, message }) => {
            await report({ phase: message, progress: progress * 0.1 });
          },
        });

    if (!process.env.VERCEL) {
      // Local only: on Vercel the bundle already lives in the snapshot.
      bundleRemotionProject(".remotion");
      await addBundleToSandbox({ sandbox, bundleDir: ".remotion" });
    }

    const { sandboxFilePath, contentType } = await renderMediaOnVercel({
      sandbox,
      compositionId: COMP_NAME,
      inputProps: { project },
      onProgress: async (update) => {
        switch (update.stage) {
          case "opening-browser":
            await report({ phase: "Browser wird geöffnet", progress: 0.12 });
            break;
          case "selecting-composition":
            await report({ phase: "Komposition wird gewählt", progress: 0.18 });
            break;
          case "render-progress":
            await report({
              phase: `Rendert ${Math.round(update.overallProgress * totalFrames)} von ${totalFrames} Frames`,
              progress: 0.2 + update.overallProgress * 0.75,
            });
            break;
          default:
            break;
        }
      },
    });

    await report({ phase: "Video wird hochgeladen", progress: 0.96 }, true);

    const { url, size } = await uploadToVercelBlob({
      sandbox,
      sandboxFilePath,
      contentType,
      blobToken: process.env.BLOB_READ_WRITE_TOKEN as string,
      access: "public",
    });

    await report(
      {
        status: "done",
        progress: 1,
        phase: "Gerendert",
        outputUrl: url,
        sizeBytes: size,
      },
      true,
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[/api/render]", err);
    await report(
      {
        status: "error",
        progress: 0,
        phase: "Abgebrochen",
        error:
          err instanceof Error
            ? err.message.slice(0, 300)
            : "Unbekannter Fehler beim Rendern.",
      },
      true,
    );
  } finally {
    await sandbox?.stop().catch(() => {});
  }
}
