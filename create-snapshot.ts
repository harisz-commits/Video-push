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
    if (value && name.endsWith("READ_WRITE_TOKEN")) return value;
  }
  return null;
}

/** Names of anything Blob-ish in the environment, to make a skip diagnosable. */
function blobEnvNames(): string[] {
  return Object.keys(process.env)
    .filter((n) => n.includes("BLOB") || n.endsWith("READ_WRITE_TOKEN"))
    .sort();
}

const snapshotBlobKey = () =>
  `snapshot-cache/${process.env.VERCEL_DEPLOYMENT_ID ?? "local"}.json`;

async function main(): Promise<void> {
  const blobToken = findBlobToken();
  if (!blobToken) {
    console.log(
      [
        "[snapshot] ============================================================",
        "[snapshot] ÜBERSPRUNGEN — kein Blob-Token in der Umgebung gefunden.",
        "[snapshot] Dieser Build ist GRÜN, aber es entsteht KEIN Snapshot,",
        "[snapshot] und zur Laufzeit wird jede kostenpflichtige Route abgelehnt.",
        "[snapshot] Beim allerersten Deployment ist das erwartet; danach nicht.",
        `[snapshot] Blob-nahe Variablen in dieser Umgebung: ${
          blobEnvNames().join(", ") || "(keine)"
        }`,
        "[snapshot] Erwartet wird BLOB_READ_WRITE_TOKEN oder ein Name, der auf",
        "[snapshot] READ_WRITE_TOKEN endet.",
        "[snapshot] Nächste Schritte:",
        "[snapshot]   1. vercel.com → Storage → Blob-Store dem Projekt zuweisen",
        "[snapshot]   2. Neu deployen — dann läuft dieser Schritt durch",
        "[snapshot] ============================================================",
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

  // Cores are set HERE, not when the snapshot is restored: a restore inherits
  // the snapshot's resources and rejects any attempt to change them. Rendering
  // is parallel across frames, and the default allotment managed about nine
  // frames a second — far too slow for a five-minute video inside a sandbox
  // whose lifetime cannot be extended either.
  //
  // How many cores an account may ask for varies, and asking for too many
  // fails the call. The build must not die over that, so we step down and take
  // whatever is granted — a slower snapshot still beats no deployment.
  const onProgress = ({
    progress,
    message,
  }: {
    progress: number;
    message: string;
  }) => {
    console.log(`[snapshot] ${message} (${Math.round(progress * 100)}%)`);
  };

  let sandbox: Awaited<ReturnType<typeof createSandbox>> | null = null;
  for (const vcpus of [8, 4, 2]) {
    try {
      sandbox = await createSandbox({ resources: { vcpus }, onProgress });
      console.log(`[snapshot] Sandbox mit ${vcpus} vCPUs`);
      break;
    } catch (err) {
      console.log(
        `[snapshot] ${vcpus} vCPUs abgelehnt (${(err as Error).message.slice(0, 120)}), versuche weniger…`,
      );
    }
  }
  if (!sandbox) {
    sandbox = await createSandbox({ onProgress });
    console.log("[snapshot] Sandbox mit Standard-Ausstattung");
  }

  console.log("[snapshot] Remotion-Bundle wird erzeugt…");
  bundleRemotionProject(".remotion");
  await ensureSandboxBundleRoot(sandbox);
  await addBundleToSandbox({ sandbox, bundleDir: ".remotion" });

  console.log("[snapshot] Snapshot wird gezogen…");
  const { snapshotId } = await sandbox.snapshot({ expiration: 0 });

  await put(snapshotBlobKey(), JSON.stringify({ snapshotId }), {
    access: process.env.BLOB_ACCESS === "private" ? "private" : "public",
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
