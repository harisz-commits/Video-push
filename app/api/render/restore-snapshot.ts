import { get } from "@vercel/blob";
import { Sandbox } from "@vercel/sandbox";
import { BLOB_ACCESS, resolveBlobToken } from "../../../lib/store";

/**
 * How long the sandbox may live, longest first.
 *
 * It has to outlast the render, not the request that started it: a detached
 * render keeps working after the response is sent, and a sandbox that expired
 * meanwhile would take the render with it. So we ask for as much as we can get.
 *
 * The ceiling depends on the account, and asking for more than it allows fails
 * the whole call with sandbox_timeout_invalid rather than clamping. Rather than
 * hardcode a guess that is wrong on some other plan, we walk down until one is
 * accepted, and report which.
 */
const SANDBOX_LIFETIMES = [30, 20, 15, 10, 5].map((m) => m * 60 * 1000);

/** The longest lifetime this account accepted, remembered between calls. */
let acceptedLifetime: number | null = null;

// No resources override here on purpose: a snapshot restored with a different
// allotment than it was created with is rejected outright ("Status code 400 is
// not ok"), which fails the render before it starts. Speed comes from the
// render being detached, not from cores this call is not allowed to change.

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

  const candidates = acceptedLifetime
    ? [acceptedLifetime]
    : SANDBOX_LIFETIMES;

  let lastError: unknown;
  for (const timeout of candidates) {
    try {
      const sandbox = await Sandbox.create({
        source: { type: "snapshot", snapshotId },
        timeout,
      });
      acceptedLifetime = timeout;
      // eslint-disable-next-line no-console
      console.log(`[render] Sandbox-Laufzeit: ${timeout / 60000} Minuten`);
      return { sandbox, lifetimeMs: timeout };
    } catch (err) {
      if (!isTimeoutRejection(err)) throw err;
      lastError = err;
    }
  }
  throw lastError;
}

/** Distinguishes "that lifetime is too long" from every other failure. */
function isTimeoutRejection(err: unknown): boolean {
  const text = JSON.stringify(
    (err as { text?: unknown; json?: unknown })?.text ??
      (err as { json?: unknown })?.json ??
      (err as Error)?.message ??
      "",
  );
  return text.includes("sandbox_timeout_invalid");
}
