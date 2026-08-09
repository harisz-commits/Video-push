import { get } from "@vercel/blob";
import { Sandbox } from "@vercel/sandbox";

const SANDBOX_CREATING_TIMEOUT = 5 * 60 * 1000;

const getSnapshotBlobKey = () =>
  `snapshot-cache/${process.env.VERCEL_DEPLOYMENT_ID ?? "local"}.json`;

export async function restoreSnapshot() {
  const blob = await get(getSnapshotBlobKey(), {
    access: "public",
    token: process.env.BLOB_READ_WRITE_TOKEN,
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
    timeout: SANDBOX_CREATING_TIMEOUT,
  });
}
