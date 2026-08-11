import { Snapshot } from "@vercel/sandbox";

/**
 * Keeping the snapshot store from filling up.
 *
 * The build takes a snapshot of a sandbox that already has Chromium and the
 * Remotion bundle in it, so a render restores in seconds instead of building
 * from scratch. It took that snapshot with `expiration: 0` — never expires —
 * and never deleted the one it replaced. One deployment, one permanent
 * snapshot, several gigabytes each, forever.
 *
 * That ran the Hobby plan's snapshot storage into its ceiling, at which point
 * the API refuses to create any more:
 *
 *   Hobby plan usage limit exceeded for Snapshots Storage.
 *
 * and every deployment since has shipped without a snapshot, which is why
 * rendering stopped working. The fix is in two halves: snapshots now expire on
 * their own, and the old ones get deleted rather than accumulating.
 */

/**
 * How many snapshots survive a prune.
 *
 * One, because only one is ever used: the render route looks up the snapshot
 * belonging to the deployment that is serving the request, and there is only
 * ever one of those. Older ones belong to deployments nobody is talking to.
 */
const DEFAULT_KEEP = 1;

/**
 * Whether a snapshot can still be booted from.
 *
 * Reusing one across deployments means trusting an id written by an earlier
 * build, and that id can have expired or been pruned since. Asking first turns
 * a broken render into a rebuilt snapshot.
 */
export async function snapshotAlive(snapshotId: string): Promise<boolean> {
  try {
    const snapshot = await Snapshot.get({ snapshotId });
    if (snapshot.status !== "created") return false;

    // Status alone is not aliveness. A snapshot past its expiry still lists
    // itself as "created" and still refuses to boot — the restore comes back
    // 410, "Snapshot expired or deleted". Believing the status meant a build
    // would happily reuse a corpse and skip creating the replacement.
    const expiresAt = snapshot.expiresAt?.getTime();
    if (expiresAt === undefined) return true;

    // Margin, because the reuse decision is made minutes before the first
    // render that depends on it.
    return expiresAt > Date.now() + 60 * 60_000;
  } catch {
    return false;
  }
}

export type PruneResult = {
  /** Everything alive before the prune, newest first. */
  inventory: {
    id: string;
    status: string;
    ageHours: number;
    sizeBytes: number;
    /** When the API says it dies — the field that explains a 410 on restore. */
    expiresAt: string | null;
  }[];
  kept: string[];
  deleted: string[];
  failed: { id: string; error: string }[];
  freedBytes: number;
  totalBytesBefore: number;
};

/**
 * Delete snapshots that nothing is going to boot from again.
 *
 * @param keep    How many of the newest healthy snapshots to spare.
 * @param keepIds Snapshots to spare regardless of age — the one the running
 *                deployment depends on, so a prune never breaks live rendering.
 */
export async function pruneSnapshots({
  keep = DEFAULT_KEEP,
  keepIds = [],
}: { keep?: number; keepIds?: string[] } = {}): Promise<PruneResult> {
  const result: PruneResult = {
    inventory: [],
    kept: [],
    deleted: [],
    failed: [],
    freedBytes: 0,
    totalBytesBefore: 0,
  };

  type Row = {
    id: string;
    status: "failed" | "created" | "deleted";
    createdAt: number;
    sizeBytes: number;
    expiresAt?: number;
  };
  const rows: Row[] = [];

  // Paginated by timestamp: `next` is the cursor for older entries. Bounded so
  // a surprising API answer cannot turn a cleanup into an endless loop.
  let until: number | undefined;
  for (let page = 0; page < 20; page++) {
    const listed = await Snapshot.list(until ? { until, limit: 100 } : { limit: 100 });
    rows.push(...(listed.json.snapshots as Row[]));
    const next = listed.json.pagination.next;
    if (next === null || next === undefined) break;
    until = next;
  }

  // "deleted" rows are tombstones — already gone, and not occupying anything.
  const alive = rows
    .filter((s) => s.status !== "deleted")
    .sort((a, b) => b.createdAt - a.createdAt);

  for (const s of alive) {
    result.totalBytesBefore += s.sizeBytes ?? 0;
    result.inventory.push({
      id: s.id,
      status: s.status,
      ageHours: Math.round((Date.now() - s.createdAt) / 3_600_000),
      sizeBytes: s.sizeBytes ?? 0,
      expiresAt:
        s.expiresAt === undefined ? null : new Date(s.expiresAt).toISOString(),
    });
  }

  const spared = new Set(keepIds);
  // A failed snapshot cannot be booted from, so it is never worth sparing —
  // it is pure occupied space. Only healthy ones count against the keep quota.
  let healthyKept = 0;
  for (const s of alive) {
    if (healthyKept >= keep) break;
    if (s.status !== "created") continue;
    spared.add(s.id);
    healthyKept += 1;
  }

  for (const s of alive) {
    if (spared.has(s.id)) {
      result.kept.push(s.id);
      continue;
    }
    try {
      const snapshot = await Snapshot.get({ snapshotId: s.id });
      await snapshot.delete();
      result.deleted.push(s.id);
      result.freedBytes += s.sizeBytes ?? 0;
    } catch (err) {
      result.failed.push({ id: s.id, error: (err as Error).message });
    }
  }

  return result;
}
