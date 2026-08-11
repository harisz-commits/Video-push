import { Sandbox } from "@vercel/sandbox";

/**
 * Stopping sandboxes nobody is waiting for any more.
 *
 * A render deliberately leaves its sandbox running — the render happens inside
 * it, detached, so stopping it at the end of the request would kill the job.
 * Nothing then ever stopped it, which means every render left a virtual machine
 * behind until it timed out on its own. That is a running cost for no work, and
 * once enough of them pile up new sandboxes stop being granted at all — which
 * takes the *build* down with them, because the deployment's snapshot step
 * needs a sandbox of its own.
 *
 * So: a render stops its sandbox the moment the progress route sees it finish,
 * and this sweep catches the ones whose watcher went away — a closed tab, a
 * failed poll, a render nobody came back for.
 */

/**
 * How long a sandbox may run before the sweep takes it.
 *
 * Comfortably longer than a full five-minute video takes to render, so an
 * in-flight job is never killed by the cleanup that exists to protect it.
 */
const MAX_SANDBOX_MINUTES = Number.parseInt(
  process.env.SANDBOX_MAX_MINUTES ?? "45",
  10,
);

export type SweepResult = {
  running: number;
  /** What is actually alive, so a stuck machine can be recognised as stuck. */
  inventory: {
    id: string;
    status: string;
    ageMinutes: number;
    vcpus: number;
    fromSnapshot: boolean;
  }[];
  stopped: string[];
  failed: { id: string; error: string }[];
};

/** Stop one sandbox, swallowing the "already gone" case. */
export async function stopSandbox(sandboxId: string): Promise<boolean> {
  try {
    const sandbox = await Sandbox.get({ sandboxId });
    await sandbox.stop();
    return true;
  } catch {
    // Already stopped, already reclaimed, or never existed. All the same to us.
    return false;
  }
}

export async function sweepSandboxes(): Promise<SweepResult> {
  const result: SweepResult = {
    running: 0,
    inventory: [],
    stopped: [],
    failed: [],
  };
  const cutoff = Date.now() - MAX_SANDBOX_MINUTES * 60_000;

  // The list call returns the raw response alongside the parsed body; the
  // sandboxes live under `json`.
  const page = await Sandbox.list();
  for (const sandbox of page.json.sandboxes) {
    if (sandbox.status !== "running" && sandbox.status !== "pending") continue;
    result.running += 1;

    const startedAt = sandbox.startedAt ?? sandbox.createdAt;
    result.inventory.push({
      id: sandbox.id,
      status: sandbox.status,
      ageMinutes: Math.round((Date.now() - startedAt) / 60_000),
      vcpus: sandbox.vcpus,
      fromSnapshot: Boolean(sandbox.sourceSnapshotId),
    });

    if (startedAt > cutoff) continue;

    try {
      const live = await Sandbox.get({ sandboxId: sandbox.id });
      await live.stop();
      result.stopped.push(sandbox.id);
    } catch (err) {
      result.failed.push({ id: sandbox.id, error: (err as Error).message });
    }
  }

  return result;
}
