import { del, get } from "@vercel/blob";
import { Sandbox } from "@vercel/sandbox";
import { BLOB_ACCESS, resolveBlobToken } from "../../../lib/store";

/**
 * The lifetime a restored snapshot accepts.
 *
 * Not a choice — anything else is refused with sandbox_timeout_invalid,
 * "extension would exceed maximum execution timeout". A restore inherits the
 * snapshot's execution budget and cannot extend it.
 *
 * What a restore does NOT inherit is the machine. This comment used to claim
 * it did — "speed comes from the cores the snapshot was built with" — and that
 * was simply wrong: the sandbox reported two cores and 4,283 MB while the
 * snapshot had been built asking for eight. See VCPU_LADDER below.
 *
 * Note also that this value is not the real ceiling on a render. It is only
 * consulted when the sandbox reports an unrecognised stage; a render that
 * keeps reporting progress runs well past it, and the wall it eventually hits
 * is the platform's own limit near forty-five minutes.
 */
const SANDBOX_LIFETIME = 5 * 60 * 1000;

/**
 * How many cores a render gets, best first.
 *
 * This was the single most expensive oversight in the render path. The
 * snapshot is BUILT asking for eight vCPUs, but restoring it asked for
 * nothing — and a sandbox with no `resources` gets the default. Measured on
 * the running machine: two cores, 4,283 MB, which is exactly two times the
 * documented 2,048 MB per vCPU. Every render this studio has ever produced
 * ran on a quarter of the machine it could have had.
 *
 * Rendering is almost pure CPU: Remotion paints frames in parallel Chromium
 * tabs and then encodes. Cores are therefore close to linear here, which is
 * why a sixteen-minute video crawled at three frames a second.
 *
 * A ladder rather than a single value, because the account may refuse the
 * largest size and being refused must not mean no render at all.
 */
const VCPU_LADDER = [8, 4, 2];

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
async function forget(
  snapshotId: string,
  fingerprint: string | undefined,
): Promise<void> {
  const token = resolveBlobToken()?.value;
  if (!token) return;
  const keys = [getSnapshotBlobKey()];

  // The content-keyed pointer is shared between deployments, so it is only
  // this deployment's business when it names the snapshot that just failed.
  // An old deployment discovering its own snapshot is gone must not invalidate
  // a perfectly good one that newer deployments are rendering from — that
  // would turn one stale tab into a fresh seven hundred megabytes.
  if (fingerprint) {
    const key = `snapshot-cache/bundle-${fingerprint}.json`;
    const shared = await get(key, { access: BLOB_ACCESS, token })
      .then((b) => (b ? new Response(b.stream).json() : null))
      .then((j) => (j as { snapshotId?: string } | null)?.snapshotId)
      .catch(() => undefined);
    if (shared === snapshotId) keys.push(key);
  }

  await del(keys, { token }).catch(() => {
    // Best effort. A failure here costs a redeploy, not correctness.
  });
}

/**
 * What to say when this deployment has no snapshot to restore.
 *
 * It used to name a cause: "beim Build war noch kein Blob-Store verbunden."
 * That is one cause and, once a store is attached, usually the wrong one — the
 * step also skips when the token was missing from the BUILD environment of
 * this particular deployment, and it fails outright when the account refuses a
 * sandbox or the snapshot storage is full. Sent as a fact, the guess costs a
 * trip to the Vercel dashboard to fix something that was never broken.
 *
 * So it says what is known, gives the step that fixes every version of it, and
 * points at the one place that knows which version this is.
 */
const NO_SNAPSHOT =
  "Für dieses Deployment existiert kein Sandbox-Snapshot — der Build hat ihn " +
  "weder erzeugt noch wiederverwendet. Skript, Stimme und Quiz laufen normal, " +
  "nur Rendern nicht. Meistens hilft ein neues Deployment. Warum er fehlt, " +
  "steht unter /api/health bei „snapshot“: ein übersprungener Schritt, ein " +
  "voller Snapshot-Speicher und ein abgelehnter Sandbox-Zugriff sehen hier " +
  "gleich aus, brauchen aber verschiedene Handgriffe.";

export async function restoreSnapshot() {
  const blob = await get(getSnapshotBlobKey(), {
    access: BLOB_ACCESS,
    token: resolveBlobToken()?.value,
  });
  if (!blob) {
    throw new Error(NO_SNAPSHOT);
  }

  const response = new Response(blob.stream);
  const cache: { snapshotId: string; fingerprint?: string } =
    await response.json();
  const snapshotId = cache.snapshotId;

  if (!snapshotId) {
    throw new Error(NO_SNAPSHOT);
  }

  let sandbox: Awaited<ReturnType<typeof Sandbox.create>> | null = null;
  let lastError: unknown = null;
  try {
    for (const vcpus of VCPU_LADDER) {
      try {
        sandbox = await Sandbox.create({
          source: { type: "snapshot", snapshotId },
          timeout: SANDBOX_LIFETIME,
          resources: { vcpus },
        });
        break;
      } catch (err) {
        // A refused size is not a broken snapshot. Only the last rung's
        // failure means the snapshot itself will not boot, and that is the one
        // the handler below is written for.
        lastError = err;
      }
    }
    if (!sandbox) throw lastError ?? new Error("Keine Sandbox erhalten.");
  } catch (err) {
    // A snapshot that will not boot must not be handed to the next build as a
    // reusable one. Builds decide whether to create a snapshot by asking the
    // API whether the remembered one is alive, and the API cheerfully reports
    // a dead snapshot as "created" — so without this, a redeploy would reuse
    // the corpse and the render would keep failing with no way out but
    // guessing. Forgetting it here is what makes the next deploy a fix.
    await forget(snapshotId, cache.fingerprint);

    throw new Error(
      "Der Sandbox-Snapshot dieses Deployments lässt sich nicht mehr starten. Er ist jetzt vergessen — das nächste Deployment erzeugt einen neuen, danach läuft Rendern wieder. "
        + `(${(err as Error).message.slice(0, 160)})`,
    );
  }
  return { sandbox, lifetimeMs: SANDBOX_LIFETIME };
}
