import { get } from "@vercel/blob";
import { Sandbox } from "@vercel/sandbox";
import { BLOB_ACCESS, resolveBlobToken } from "../../../lib/store";

/**
 * How long the sandbox may live.
 *
 * It has to outlast the render, not the request that started it: a detached
 * render keeps working after the response is sent, and a sandbox that expired
 * meanwhile would take the render with it.
 */
const SANDBOX_LIFETIME = 45 * 60 * 1000;

/**
 * Cores to give it. Rendering is parallel across frames, and the default
 * allotment managed about nine frames a second — twenty minutes for a
 * six-minute video.
 */
const SANDBOX_RESOURCES = { vcpus: 8 } as const;

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

  return Sandbox.create({
    source: { type: "snapshot", snapshotId },
    timeout: SANDBOX_LIFETIME,
    resources: SANDBOX_RESOURCES,
  });
}
