/**
 * Build-time step: bundle Remotion, boot a sandbox with that bundle in it, and
 * store a snapshot of the result.
 *
 * The render route restores this snapshot instead of installing Chromium and
 * bundling on every render. Without it the first render of each deployment
 * would take minutes.
 *
 * Skipped when there is no Blob store yet. That case is not a
 * misconfiguration, it is the normal first deploy: a Blob store can only be
 * attached to a project that already exists, so the very first build
 * necessarily runs without a token. Failing here would make that first deploy
 * impossible and leave no project to attach a store to. The app still deploys
 * and serves; only rendering waits for the redeploy, and /api/render says so.
 */
/** Same prefix-tolerant lookup as lib/store.ts, inlined to keep this import-free. */
function findBlobToken(): string | null {
  if (process.env.BLOB_READ_WRITE_TOKEN) return process.env.BLOB_READ_WRITE_TOKEN;
  for (const [name, value] of Object.entries(process.env)) {
    if (value && name.endsWith("BLOB_READ_WRITE_TOKEN")) return value;
  }
  return null;
}

const snapshotBlobKey = () =>
  `snapshot-cache/${process.env.VERCEL_DEPLOYMENT_ID ?? "local"}.json`;

async function main(): Promise<void> {
  const blobToken = findBlobToken();
  if (!blobToken) {
    console.log(
      [
        "[snapshot] Übersprungen: kein Blob-Token in der Umgebung gefunden.",
        "[snapshot] Das ist beim allerersten Deployment normal.",
        "[snapshot] Nächste Schritte:",
        "[snapshot]   1. vercel.com → Storage → Create Database → Blob",
        "[snapshot]   2. Den Store diesem Projekt zuweisen",
        "[snapshot]   3. Neu deployen — dann läuft dieser Schritt durch",
        "[snapshot] Bis dahin ist die App nutzbar, nur Rendern ist gesperrt.",
      ].join("\n"),
    );
    return;
  }

  // Imported lazily so the skip path above needs neither the Remotion bundler
  // nor the Blob client — it should cost nothing on a first deploy.
  const { addBundleToSandbox, createSandbox } = await import("@remotion/vercel");
  const { put } = await import("@vercel/blob");
  const { bundleRemotionProject, ensureSandboxBundleRoot } = await import(
    "./app/api/render/helpers.ts"
  );

  const sandbox = await createSandbox({
    onProgress: ({ progress, message }) => {
      console.log(`[snapshot] ${message} (${Math.round(progress * 100)}%)`);
    },
  });

  console.log("[snapshot] Remotion-Bundle wird erzeugt…");
  bundleRemotionProject(".remotion");
  await ensureSandboxBundleRoot(sandbox);
  await addBundleToSandbox({ sandbox, bundleDir: ".remotion" });

  console.log("[snapshot] Snapshot wird gezogen…");
  const { snapshotId } = await sandbox.snapshot({ expiration: 0 });

  await put(snapshotBlobKey(), JSON.stringify({ snapshotId }), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
    token: blobToken,
  });

  console.log(`[snapshot] Gespeichert: ${snapshotId}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
