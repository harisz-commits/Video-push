import { get } from "@vercel/blob";
import { Sandbox } from "@vercel/sandbox";
import { BLOB_ACCESS, resolveBlobToken } from "../../../lib/store";

/**
 * The lifetime a restored snapshot accepts.
 *
 * Not a choice — anything else is refused with sandbox_timeout_invalid,
 * "extension would exceed maximum execution timeout". A restore inherits the
 * snapshot's execution budget and cannot extend it, so the render has to fit
 * in this window. Speed therefore comes from the cores the snapshot was built
 * with (see create-snapshot.ts), which a restore does inherit.
 */
const SANDBOX_LIFETIME = 5 * 60 * 1000;

const getSnapshotBlobKey = () =>
  `snapshot-cache/${process.env.VERCEL_DEPLOYMENT_ID ?? "local"}.json`;

export async function restoreSnapshot() {
  const blob = await get(getSnapshotBlobKey(), {
    access: BLOB_ACCESS,
    token: resolveBlobToken()?.value,
  });
  if (!blob) {
    throw new Error(
      "Für dieses Deployment existiert kein Sandbox-Snapshot. Das ist der Fall, "
      + "wenn beim Build noch kein Blob-Store verbunden war. Blob-Store auf "
      + "vercel.com anlegen, dem Projekt zuweisen und einmal neu deployen — "
      + "dann wird der Snapshot beim Build erzeugt.",
    );
  }

  const response = new Response(blob.stream);
  const cache: { snapshotId: string } = await response.json();
  const snapshotId = cache.snapshotId;

  if (!snapshotId) {
    throw new Error(
      "Für dieses Deployment existiert kein Sandbox-Snapshot. Das ist der Fall, "
      + "wenn beim Build noch kein Blob-Store verbunden war. Blob-Store auf "
      + "vercel.com anlegen, dem Projekt zuweisen und einmal neu deployen — "
      + "dann wird der Snapshot beim Build erzeugt.",
    );
  }

  const sandbox = await Sandbox.create({
    source: { type: "snapshot", snapshotId },
    timeout: SANDBOX_LIFETIME,
  });
  return { sandbox, lifetimeMs: SANDBOX_LIFETIME };
}
