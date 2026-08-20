import { list } from "@vercel/blob";
import { Sandbox } from "@vercel/sandbox";
import { readJson, resolveBlobToken, type RenderJob } from "./store";

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
 * Was forty-five minutes, on the assumption that a sandbox stops itself when
 * its lease runs out and the sweep only ever has to catch strays. It does not:
 * one left over from a render was measured still running thirty minutes after
 * a five-minute lease, and it would have kept going. Nothing stops a sandbox
 * except being stopped.
 *
 * A restored snapshot cannot be granted more than five minutes of lifetime
 * (see restore-snapshot.ts), so no render can legitimately need a machine for
 * ten. Anything older than that is abandoned by definition.
 */
const MAX_SANDBOX_MINUTES = Number.parseInt(
  process.env.SANDBOX_MAX_MINUTES ?? "10",
  10,
);

/**
 * How long a sandbox that a render is still using is left alone.
 *
 * The ten minutes above are right for a stray and catastrophically wrong for a
 * working machine: a sixteen-minute film renders in about seventeen. While the
 * sweep ran once a day that almost never collided with anything; run hourly it
 * would kill roughly every long render in progress. So a sandbox named by a
 * render whose video has not appeared yet is protected — up to this ceiling,
 * past which it cannot be doing useful work anyway. The longest render ever
 * measured here died at forty-nine minutes.
 */
const RENDER_CEILING_MINUTES = 60;

/**
 * And how long a sandbox that no render claims is left alone.
 *
 * Not every sandbox is a render's. The build creates one of its own to make
 * the deployment snapshot, and that one is created from scratch rather than
 * restored — which is exactly how it can be told apart. Stopping it midway
 * would fail the deploy, so anything not restored from a snapshot gets the
 * longer leash.
 */
const BUILD_SANDBOX_MINUTES = 45;

/**
 * The sandboxes a render is still using.
 *
 * Answered from storage rather than from a status somebody wrote down, on the
 * same principle the rest of this codebase settled on: the truth about a
 * render is whether its file is there. One listing gives both halves — the job
 * documents under renders/{id}/progress.json and the finished videos at
 * renders/{id}.mp4 — so a render with a video is done and its machine is fair
 * game, and one without is presumed working.
 *
 * When this cannot answer — no blob token, a failed listing — it says so with
 * `known: false` rather than returning an empty set, and the sweep then falls
 * back to leaving every render-shaped machine alone for the full ceiling. An
 * empty set would be read as "no render is working", which is the one wrong
 * answer that costs a video rather than a few cents.
 */
async function busySandboxes(): Promise<{
  ids: Set<string>;
  renders: number;
  known: boolean;
}> {
  const ids = new Set<string>();
  const token = resolveBlobToken()?.value;
  if (!token) return { ids, renders: 0, known: false };

  const cutoff = Date.now() - RENDER_CEILING_MINUTES * 60_000;
  const jobs: string[] = [];
  const finished = new Set<string>();

  let cursor: string | undefined;
  do {
    const page = await list({ prefix: "renders/", cursor, limit: 1000, token });
    for (const blob of page.blobs) {
      if (blob.pathname.endsWith(".mp4")) {
        finished.add(blob.pathname.slice("renders/".length, -".mp4".length));
        continue;
      }
      if (!blob.pathname.endsWith("/progress.json")) continue;
      // Older than the ceiling: nothing it names can still be working, so the
      // document is not worth a fetch.
      if (new Date(blob.uploadedAt).getTime() < cutoff) continue;
      jobs.push(blob.pathname);
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);

  let renders = 0;
  await Promise.all(
    jobs.map(async (pathname) => {
      const renderId = pathname.slice("renders/".length, -"/progress.json".length);
      if (finished.has(renderId)) return;

      const job = await readJson<RenderJob>(pathname).catch(() => null);
      if (!job) return;
      renders += 1;

      // Every machine the job knows about: the single sandbox, the pieces of a
      // sectioned render, and the one joining them at the end.
      ids.add(job.sandboxId);
      for (const segment of job.segments ?? []) ids.add(segment.sandboxId);
      if (job.stitch) ids.add(job.stitch.sandboxId);
    }),
  );

  return { ids, renders, known: true };
}

export type SweepResult = {
  running: number;
  /** What is actually alive, so a stuck machine can be recognised as stuck. */
  inventory: {
    id: string;
    status: string;
    ageMinutes: number;
    vcpus: number;
    fromSnapshot: boolean;
    /** Why it is still alive, when it is. */
    kept?: string;
  }[];
  stopped: string[];
  failed: { id: string; error: string }[];
  /** Renders still working, so a sweep that stopped nothing can say why. */
  busyRenders: number;
};

/** Stop one sandbox, swallowing the "already gone" case. */
export async function stopSandbox(sandboxId: string): Promise<boolean> {
  try {
    const sandbox = await Sandbox.get({ sandboxId });
    await sandbox.stop();
    return true;
  } catch (err) {
    // Already stopped, already reclaimed, or never existed — all the same to
    // the caller, which is why this returns rather than throws. It is logged
    // because a stop that quietly fails costs a running machine, and the last
    // one of those went unnoticed until it was measured from outside.
    // eslint-disable-next-line no-console
    console.error(`[sandbox] Stoppen von ${sandboxId} fehlgeschlagen:`, err);
    return false;
  }
}

/**
 * How long this particular machine is left alone, and why.
 *
 * Its own function because it is the part where a mistake is expensive in the
 * wrong direction: too generous costs a few cents an hour, too strict kills a
 * render somebody has already paid three dollars of pictures for. Pure, so it
 * can be checked without a Vercel account.
 */
export function leashFor(args: {
  /** True when it was restored from the render snapshot. */
  fromSnapshot: boolean;
  /** True when a render job that has produced no video yet names it. */
  claimedByRender: boolean;
  /** False when the render jobs could not be read at all. */
  renderStateKnown: boolean;
}): { minutes: number; reason: string } {
  // Claimed by a live render: the full ceiling.
  if (args.claimedByRender) {
    return { minutes: RENDER_CEILING_MINUTES, reason: "rendert noch" };
  }

  // Not restored from the snapshot, so not a render at all — this is the
  // machine the build uses to create the snapshot in the first place, and
  // stopping it halfway fails the deployment.
  if (!args.fromSnapshot) {
    return { minutes: BUILD_SANDBOX_MINUTES, reason: "Build" };
  }

  // Render-shaped, claimed by nothing — but only actually a stray if the
  // question could be asked. Unanswered, it gets the benefit of the doubt: an
  // idle machine living an extra fifty minutes costs about twenty-eight cents,
  // and a killed render costs the whole render.
  if (!args.renderStateKnown) {
    return { minutes: RENDER_CEILING_MINUTES, reason: "Zustand unbekannt" };
  }

  return { minutes: MAX_SANDBOX_MINUTES, reason: "verwaist" };
}

export async function sweepSandboxes(): Promise<SweepResult> {
  const busy = await busySandboxes().catch(() => ({
    ids: new Set<string>(),
    renders: 0,
    known: false,
  }));

  const result: SweepResult = {
    running: 0,
    inventory: [],
    stopped: [],
    failed: [],
    busyRenders: busy.renders,
  };

  const now = Date.now();

  // The list call returns the raw response alongside the parsed body; the
  // sandboxes live under `json`.
  const page = await Sandbox.list();
  for (const sandbox of page.json.sandboxes) {
    if (sandbox.status !== "running" && sandbox.status !== "pending") continue;
    result.running += 1;

    const startedAt = sandbox.startedAt ?? sandbox.createdAt;
    const ageMinutes = Math.round((now - startedAt) / 60_000);
    const fromSnapshot = Boolean(sandbox.sourceSnapshotId);

    const leash = leashFor({
      fromSnapshot,
      claimedByRender: busy.ids.has(sandbox.id),
      renderStateKnown: busy.known,
    });

    const kept =
      ageMinutes >= leash.minutes
        ? undefined
        : `${leash.reason} (${ageMinutes}/${leash.minutes} min)`;

    result.inventory.push({
      id: sandbox.id,
      status: sandbox.status,
      ageMinutes,
      vcpus: sandbox.vcpus,
      fromSnapshot,
      kept,
    });

    if (kept) continue;

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
