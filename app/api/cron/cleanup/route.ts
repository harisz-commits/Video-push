import { del, list } from "@vercel/blob";
import { errorResponse } from "../../../../lib/guardrails";
import { audioInUse } from "../../../../lib/projects";
import { sweepSandboxes } from "../../../../lib/sandboxes";
import { pruneSnapshots } from "../../../../lib/snapshots";
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
 * deploy, so it must never be swept up by an age rule. `projects/` is what a
 * saved project *is*, and has no age at which it stops mattering.
 */
const SWEEPABLE = ["renders/", "audio/", "jobs/"];

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
    // Age alone stopped being a good enough reason to delete audio the moment
    // projects started outliving the session that made them: a saved project
    // holds a URL to its voiceover, and a swept-away file leaves a project that
    // will neither play nor render, with nothing to explain why. Costing a
    // listing to avoid that is the cheaper side of the trade.
    const protectedAudio = await audioInUse().catch(() => new Set<string>());

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
          (b) =>
            new Date(b.uploadedAt).getTime() < cutoff &&
            !protectedAudio.has(b.pathname),
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

    // Storage is the cheap half of this job. The expensive half is virtual
    // machines: a render leaves its sandbox running on purpose, and when the
    // browser that started it never comes back to see it finish, nobody stops
    // it. Enough of those and the account stops granting sandboxes at all —
    // which breaks deployments too, since the build needs one for its snapshot.
    const sandboxes = await sweepSandboxes().catch((err) => ({
      running: -1,
      stopped: [],
      failed: [{ id: "sweep", error: (err as Error).message }],
    }));

    // Finished videos that no project points at.
    //
    // Reported, never deleted. Every render before renders were filed against
    // their project produced a video that exists in storage and is reachable
    // from nowhere — and a video nobody can find is indistinguishable from one
    // that was never made, except that this one was paid for. Listing them is
    // the only way back to them.
    const orphans: { pathname: string; url: string; sizeBytes: number; at: string }[] = [];
    {
      let cursor: string | undefined;
      do {
        const page = await list({
          prefix: "renders/",
          cursor,
          limit: 1000,
          token: blob.value,
        });
        for (const b of page.blobs) {
          if (!b.pathname.endsWith(".mp4")) continue;
          if (protectedAudio.has(b.pathname)) continue;
          orphans.push({
            pathname: b.pathname,
            url: b.url,
            sizeBytes: b.size,
            at: b.uploadedAt as unknown as string,
          });
        }
        cursor = page.hasMore ? page.cursor : undefined;
      } while (cursor);
    }

    // Snapshots are the other half of that cost, and the more damaging one: a
    // sandbox stops by itself eventually, a snapshot sits there until deleted.
    // The build prunes them too, but only when there is a build — and a project
    // nobody is deploying is exactly the one that quietly fills up. Keeping the
    // newest spares whatever the live deployment renders from.
    const snapshots = await pruneSnapshots({ keep: 1 }).catch((err) => ({
      error: (err as Error).message,
    }));

    return Response.json({
      ok: true,
      maxAgeDays: MAX_AGE_DAYS,
      scanned,
      deletedCount: deleted.length,
      deleted: deleted.slice(0, 50),
      protectedFiles: protectedAudio.size,
      orphanedVideos: orphans
        .sort((a, b) => (a.at < b.at ? 1 : -1))
        .slice(0, 40),
      sandboxes,
      snapshots,
    });
  } catch (err) {
    console.error("[/api/cron/cleanup]", err);
    return errorResponse("Aufräumen fehlgeschlagen.", 500);
  }
}
