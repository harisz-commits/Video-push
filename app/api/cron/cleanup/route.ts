import { del, list } from "@vercel/blob";
import { errorResponse } from "../../../../lib/guardrails";
import { resolveBlobToken } from "../../../../lib/store";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Renders and takes are disposable; anything older than this goes. */
const MAX_AGE_DAYS = Number.parseInt(process.env.BLOB_MAX_AGE_DAYS ?? "30", 10);

/**
 * Prefixes this job is allowed to delete from.
 *
 * Deliberately an allowlist. `snapshot-cache/` holds the sandbox snapshot the
 * render route boots from — deleting it would break rendering until the next
 * deploy, so it must never be swept up by an age rule.
 */
const SWEEPABLE = ["renders/", "audio/"];

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return errorResponse("Nicht autorisiert.", 401);
    }
  }

  const blob = resolveBlobToken();
  if (!blob) {
    return errorResponse("Kein Blob-Store verbunden.", 500);
  }

  const cutoff = Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  const deleted: string[] = [];
  let scanned = 0;

  try {
    for (const prefix of SWEEPABLE) {
      let cursor: string | undefined;
      do {
        const page = await list({
          prefix,
          cursor,
          limit: 1000,
          token: blob.value,
        });
        scanned += page.blobs.length;

        const stale = page.blobs.filter(
          (b) => new Date(b.uploadedAt).getTime() < cutoff,
        );
        if (stale.length > 0) {
          await del(
            stale.map((b) => b.url),
            { token: blob.value },
          );
          deleted.push(...stale.map((b) => b.pathname));
        }

        cursor = page.hasMore ? page.cursor : undefined;
      } while (cursor);
    }

    return Response.json({
      ok: true,
      maxAgeDays: MAX_AGE_DAYS,
      scanned,
      deletedCount: deleted.length,
      deleted: deleted.slice(0, 50),
    });
  } catch (err) {
    console.error("[/api/cron/cleanup]", err);
    return errorResponse("Aufräumen fehlgeschlagen.", 500);
  }
}
