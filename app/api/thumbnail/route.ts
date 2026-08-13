import { waitUntil } from "@vercel/functions";
import { generateImage, GeminiError } from "../../../lib/gemini";
import { clientKey, errorResponse, rateLimit } from "../../../lib/guardrails";
import {
  readJson,
  thumbnailJobPath,
  writeBinary,
  writeJson,
  type ThumbnailJob,
} from "../../../lib/store";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Generate a background image for a thumbnail.
 *
 * A job like everything else expensive, even though it takes about ten
 * seconds. Ten seconds is more than enough for a phone to background the tab
 * and abort the request — which is exactly how a paid-for voiceover went
 * missing before anyone learned that lesson.
 */
export async function POST(req: Request) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return errorResponse(
      "GEMINI_API_KEY ist nicht gesetzt. Trag den Key in den Vercel-Projekt-Einstellungen ein — bis dahin funktioniert das Thumbnail ohne generiertes Bild.",
      500,
    );
  }

  let prompt: string;
  let layout: string | undefined;
  try {
    const body = (await req.json()) as { prompt?: unknown; layout?: unknown };
    if (typeof body.prompt !== "string" || body.prompt.trim().length < 8) {
      throw new Error("prompt");
    }
    prompt = body.prompt.trim().slice(0, 600);
    // Decides the framing asked for, not what is drawn — an unknown value
    // simply falls back to the safest crop rather than failing the request.
    layout = typeof body.layout === "string" ? body.layout : undefined;
  } catch {
    return errorResponse(
      "Ungültige Anfrage. Erwartet wird { prompt: string }.",
      400,
    );
  }

  // Its own small budget: a thumbnail image costs a few cents, and the failure
  // mode of a public page is somebody generating them in a loop.
  const limited = rateLimit(clientKey(req, "thumbnail"), 30, 60 * 60_000);
  if (!limited.ok) return errorResponse(limited.error, limited.status);

  const jobId = `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const startedAt = Date.now();

  await writeJson(thumbnailJobPath(jobId), {
    jobId,
    status: "running",
    startedAt,
    updatedAt: startedAt,
  } satisfies ThumbnailJob);

  waitUntil(run({ jobId, prompt, layout, apiKey, startedAt }));

  return Response.json({ jobId });
}

async function run(args: {
  jobId: string;
  prompt: string;
  layout?: string;
  apiKey: string;
  startedAt: number;
}): Promise<void> {
  try {
    const { data, mimeType } = await generateImage({
      prompt: args.prompt,
      layout: args.layout,
      apiKey: args.apiKey,
    });

    const extension = mimeType.includes("png") ? "png" : "jpg";
    const url = await writeBinary(
      `thumbnails/${args.jobId}.${extension}`,
      data,
      mimeType,
    );

    await writeJson(thumbnailJobPath(args.jobId), {
      jobId: args.jobId,
      status: "done",
      imageUrl: url,
      prompt: args.prompt,
      startedAt: args.startedAt,
      updatedAt: Date.now(),
    } satisfies ThumbnailJob);
  } catch (err) {
    await writeJson(thumbnailJobPath(args.jobId), {
      jobId: args.jobId,
      status: "error",
      error:
        err instanceof GeminiError
          ? err.message
          : `Das Bild konnte nicht erzeugt werden: ${(err as Error).message.slice(0, 200)}`,
      startedAt: args.startedAt,
      updatedAt: Date.now(),
    } satisfies ThumbnailJob).catch(() => undefined);
  }
}

export async function GET(req: Request) {
  const jobId = new URL(req.url).searchParams.get("jobId");
  if (!jobId || !/^[a-zA-Z0-9_-]{6,64}$/.test(jobId)) {
    return errorResponse("Ungültige oder fehlende jobId.", 400);
  }

  const job = await readJson<ThumbnailJob>(thumbnailJobPath(jobId));
  if (!job) return errorResponse("Zu dieser jobId gibt es kein Bild.", 404);

  if (
    job.status === "running" &&
    Date.now() - job.startedAt > (maxDuration + 30) * 1000
  ) {
    return Response.json({
      ...job,
      status: "error",
      error: "Die Bilderzeugung hat das Zeitlimit überschritten.",
    } satisfies ThumbnailJob);
  }

  return Response.json(job);
}
