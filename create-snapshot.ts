import { addBundleToSandbox, createSandbox } from "@remotion/vercel";
import { put } from "@vercel/blob";
import { bundleRemotionProject } from "./app/api/render/helpers";

/**
 * Build-time step: bundle Remotion, boot a sandbox with that bundle in it, and
 * store a snapshot of the result.
 *
 * The render route then restores this snapshot instead of installing Chromium
 * and bundling on every render. Without it the first render of each deployment
 * would take minutes.
 */
const snapshotBlobKey = () =>
  `snapshot-cache/${process.env.VERCEL_DEPLOYMENT_ID ?? "local"}.json`;

async function main(): Promise<void> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    throw new Error(
      "BLOB_READ_WRITE_TOKEN fehlt. Lege auf vercel.com unter Storage einen Blob-Store an und verbinde ihn mit diesem Projekt, bevor du deployst.",
    );
  }

  const sandbox = await createSandbox({
    onProgress: ({ progress, message }) => {
      console.log(`[snapshot] ${message} (${Math.round(progress * 100)}%)`);
    },
  });

  console.log("[snapshot] Remotion-Bundle wird erzeugt…");
  bundleRemotionProject(".remotion");
  await addBundleToSandbox({ sandbox, bundleDir: ".remotion" });

  console.log("[snapshot] Snapshot wird gezogen…");
  const { snapshotId } = await sandbox.snapshot({ expiration: 0 });

  await put(snapshotBlobKey(), JSON.stringify({ snapshotId }), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
  });

  console.log(`[snapshot] Gespeichert: ${snapshotId}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
