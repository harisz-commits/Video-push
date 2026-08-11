import { del, get } from "@vercel/blob";
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

/**
 * Drop the pointers that would make a build reuse an unusable snapshot.
 *
 * Both of them: the one naming what this deployment renders from, and the one
 * keyed by content that lets a later deployment skip creating its own. Leaving
 * the second would defeat the whole point — the next build would find it,
 * believe it, and skip the rebuild that is the actual fix.
 */
async function forget(fingerprint: string | undefined): Promise<void> {
  const token = resolveBlobToken()?.value;
  if (!token) return;
  const keys = [getSnapshotBlobKey()];
  if (fingerprint) keys.push(`snapshot-cache/bundle-${fingerprint}.json`);
  await del(keys, { token }).catch(() => {
    // Best effort. A failure here costs a redeploy, not correctness.
  });
}

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
  const cache: { snapshotId: string; fingerprint?: string } =
    await response.json();
  const snapshotId = cache.snapshotId;

  if (!snapshotId) {
    throw new Error(
      "Für dieses Deployment existiert kein Sandbox-Snapshot. Das ist der Fall, "
      + "wenn beim Build noch kein Blob-Store verbunden war. Blob-Store auf "
      + "vercel.com anlegen, dem Projekt zuweisen und einmal neu deployen — "
      + "dann wird der Snapshot beim Build erzeugt.",
    );
  }

  let sandbox: Awaited<ReturnType<typeof Sandbox.create>>;
  try {
    sandbox = await Sandbox.create({
      source: { type: "snapshot", snapshotId },
      timeout: SANDBOX_LIFETIME,
    });
  } catch (err) {
    // A snapshot that will not boot must not be handed to the next build as a
    // reusable one. Builds decide whether to create a snapshot by asking the
    // API whether the remembered one is alive, and the API cheerfully reports
    // a dead snapshot as "created" — so without this, a redeploy would reuse
    // the corpse and the render would keep failing with no way out but
    // guessing. Forgetting it here is what makes the next deploy a fix.
    await forget(cache.fingerprint);

    throw new Error(
      "Der Sandbox-Snapshot dieses Deployments lässt sich nicht mehr starten. Er ist jetzt vergessen — das nächste Deployment erzeugt einen neuen, danach läuft Rendern wieder. "
        + `(${(err as Error).message.slice(0, 160)})`,
    );
  }
  return { sandbox, lifetimeMs: SANDBOX_LIFETIME };
}
