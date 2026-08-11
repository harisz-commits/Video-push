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

/**
 * How long a snapshot lives before Vercel reclaims it.
 *
 * A deployment stops being the live one within hours; two weeks is a wide
 * margin on top of that, and the ceiling on how long an abandoned project can
 * keep occupying snapshot storage.
 */
const SNAPSHOT_TTL_DAYS = Number.parseInt(
  process.env.SNAPSHOT_TTL_DAYS ?? "14",
  10,
);

const snapshotBlobKey = () =>
  `snapshot-cache/${process.env.VERCEL_DEPLOYMENT_ID ?? "local"}.json`;

/**
 * Where a failure is recorded so the running application can report it.
 *
 * The reason this step failed used to exist only in a build log, which meant
 * the deployed app could say "no snapshot" but never why. Writing it next to
 * where the snapshot would have gone puts the answer somewhere /api/health can
 * read it, which is the difference between a diagnosis and a guess.
 */
const failureBlobKey = () =>
  `snapshot-cache/${process.env.VERCEL_DEPLOYMENT_ID ?? "local"}.error.json`;

/**
 * Pull Vercel's own words out of a Sandbox API error.
 *
 * The SDK's message for any refused call is `Status code 402 is not ok` — a
 * number and nothing else, which is enough to know the account said no and not
 * enough to know *what* it said no about. The response body it kept is the part
 * that names the reason, and that is the part worth recording: the difference
 * between "some limit, go look" and the limit itself.
 */
function apiErrorDetail(err: unknown): {
  status: number | null;
  url: string | null;
  body: string | null;
} {
  const e = err as {
    response?: { status?: number; url?: string };
    text?: string;
    json?: unknown;
  };
  const body =
    typeof e?.text === "string" && e.text.trim()
      ? e.text
      : e?.json
        ? JSON.stringify(e.json)
        : null;
  return {
    status: e?.response?.status ?? null,
    // Which endpoint refused — creating a sandbox and snapshotting one are
    // different permissions and can fail for different reasons.
    url: e?.response?.url ?? null,
    body: body ? body.slice(0, 1000) : null,
  };
}

async function recordFailure(err: unknown): Promise<void> {
  const token = findBlobToken();
  if (!token) return;
  try {
    const { put } = await import("@vercel/blob");
    await put(
      failureBlobKey(),
      JSON.stringify({
        message: (err as Error)?.message ?? String(err),
        ...apiErrorDetail(err),
        stack: (err as Error)?.stack?.split("\n").slice(0, 12).join("\n"),
        at: new Date().toISOString(),
        commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
      }),
      {
        access: process.env.BLOB_ACCESS === "private" ? "private" : "public",
        contentType: "application/json",
        addRandomSuffix: false,
        allowOverwrite: true,
        token,
      },
    );
  } catch {
    // If even this fails, the build log is all there is. Do not make it worse.
  }
}

/**
 * A fingerprint of everything that ends up inside the snapshot.
 *
 * The snapshot holds Chromium and the Remotion bundle, and nothing else in the
 * project can change what is in it. So two deployments whose render sources and
 * dependencies are identical would produce byte-identical snapshots — and there
 * is no reason for the second one to exist.
 *
 * That mattered more than it sounds: a snapshot is about seven hundred
 * megabytes, one was created per deployment, and a day of fixing API routes
 * that the renderer never sees added several gigabytes of storage for no
 * change at all. Keying the snapshot by its content instead of by the
 * deployment means only a change to the *video* costs anything.
 */
function bundleFingerprint(): string {
  const { createHash } = require("crypto") as typeof import("crypto");
  const {
    readFileSync,
    readdirSync,
    statSync,
  } = require("fs") as typeof import("fs");
  const { join } = require("path") as typeof import("path");

  const hash = createHash("sha256");

  // Everything the Remotion entry point can reach, plus what pins the versions
  // of Chromium and the renderer itself.
  //
  // `lib` is not taken wholesale on purpose: most of it — the prompts, the
  // pipeline, the storage layer — never enters the bundle, and including it
  // would mean every edit to a prompt cost a fresh seven hundred megabytes.
  // Which of its modules do end up in the video is read out of the imports
  // below rather than written down here, so adding one later cannot silently
  // leave the fingerprint blind to it.
  const roots = ["remotion", "public"];
  const files = ["package-lock.json", "package.json", "tsconfig.json"];

  const walk = (dir: string): string[] => {
    const out: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) out.push(...walk(full));
      else out.push(full);
    }
    return out;
  };

  const all: string[] = [];
  for (const root of roots) {
    try {
      if (statSync(root).isDirectory()) all.push(...walk(root));
    } catch {
      // A root that does not exist contributes nothing.
    }
  }
  // Whatever `remotion/` imports out of `lib/`, found by reading the imports.
  for (const path of [...all]) {
    if (!/\.(ts|tsx|js|jsx)$/.test(path)) continue;
    const source = readFileSync(path, "utf8");
    for (const m of source.matchAll(/["']\.{1,2}\/[./]*lib\/([a-zA-Z0-9_-]+)["']/g)) {
      for (const ext of [".ts", ".tsx"]) {
        const candidate = join("lib", m[1] + ext);
        try {
          statSync(candidate);
          files.push(candidate);
        } catch {
          /* not this extension */
        }
      }
    }
  }

  for (const f of new Set(files)) {
    try {
      statSync(f);
      all.push(f);
    } catch {
      /* optional */
    }
  }

  // Sorted, so directory iteration order cannot change the fingerprint of an
  // unchanged tree.
  for (const path of all.sort()) {
    hash.update(path);
    hash.update(new Uint8Array(readFileSync(path)));
  }
  return hash.digest("hex").slice(0, 16);
}

/** Where the snapshot for a given fingerprint is remembered. */
const fingerprintBlobKey = (fingerprint: string) =>
  `snapshot-cache/bundle-${fingerprint}.json`;

/** Read a small JSON document out of Blob storage, or null. */
async function readBlobJson<T>(key: string, token: string): Promise<T | null> {
  try {
    const { head } = await import("@vercel/blob");
    const meta = await head(key, { token });
    const res = await fetch(`${meta.url}?t=${Date.now()}`);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

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
  const { pruneSnapshots, snapshotAlive } = await import("./lib/snapshots.ts");

  // Does a snapshot for exactly this content already exist? If so, this build
  // needs no sandbox, no bundle upload and no new storage — it only has to
  // point this deployment at the image that is already there.
  const fingerprint = bundleFingerprint();
  const known = await readBlobJson<{ snapshotId: string }>(
    fingerprintBlobKey(fingerprint),
    blobToken,
  );
  if (known?.snapshotId && (await snapshotAlive(known.snapshotId))) {
    await put(snapshotBlobKey(), JSON.stringify({ snapshotId: known.snapshotId, fingerprint }), {
      access: process.env.BLOB_ACCESS === "private" ? "private" : "public",
      contentType: "application/json",
      addRandomSuffix: false,
      allowOverwrite: true,
      token: blobToken,
    });
    // Reusing skips the create path, and with it the prune that lives there —
    // so anything left over from an earlier fingerprint would sit untouched
    // until the nightly cron. Take it here instead.
    const swept = await pruneSnapshots({
      keep: 0,
      keepIds: [known.snapshotId],
    }).catch(() => null);

    console.log(
      `[snapshot] Wiederverwendet: ${known.snapshotId} (Fingerprint ${fingerprint}) — kein neuer Speicher, keine Sandbox.` +
        (swept?.deleted.length
          ? ` ${swept.deleted.length} veraltete Snapshots gelöscht.`
          : ""),
    );
    return;
  }
  console.log(
    `[snapshot] Kein Snapshot für Fingerprint ${fingerprint} — wird neu erzeugt.`,
  );

  // Before anything else, because the account may have no room left. Snapshots
  // were being created with no expiry and never deleted, so every deployment
  // added a permanent multi-gigabyte image until the plan's storage ceiling
  // refused the next one — taking rendering down with it.
  //
  // Nothing is kept, not even the live deployment's. Sparing it sounds kinder
  // and is the wrong call: two images have to fit at once for that to work, and
  // it is precisely the "one more will fit" assumption that filled the store in
  // the first place. The cost is that the currently-live deployment cannot
  // render for the few minutes this build runs; the alternative is that the new
  // deployment cannot render at all.
  try {
    const before = await pruneSnapshots({ keep: 0 });
    console.log(
      `[snapshot] Aufräumen: ${before.inventory.length} vorhanden, ${
        before.deleted.length
      } gelöscht, ${Math.round(before.freedBytes / 1e9)} GB frei gemacht` +
        (before.failed.length
          ? ` (${before.failed.length} nicht löschbar: ${before.failed[0].error.slice(0, 80)})`
          : ""),
    );
  } catch (err) {
    // Not fatal on its own: if there is room, the snapshot still succeeds.
    console.log(
      `[snapshot] Aufräumen fehlgeschlagen: ${(err as Error).message.slice(0, 200)}`,
    );
  }

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
      // Stepping down only makes sense when the *size* was the problem. When
      // the account will not grant a sandbox at all — payment, permission —
      // asking three more times changes nothing and buries the real answer
      // under two retries' worth of the same refusal.
      const { status, body } = apiErrorDetail(err);
      if (status === 401 || status === 402 || status === 403) {
        console.error(
          `[snapshot] Sandbox abgelehnt (HTTP ${status}). Antwort: ${body ?? "(leer)"}`,
        );
        throw err;
      }
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
  // Expires on its own. `expiration: 0` — the previous value — means never,
  // which is how the storage filled up: a deployment from months ago was still
  // holding its image. Fourteen days is far longer than a deployment stays the
  // live one, and it means a stretch without deploys cleans up by itself
  // instead of quietly costing storage.
  const { snapshotId } = await sandbox.snapshot({
    expiration: SNAPSHOT_TTL_DAYS * 24 * 60 * 60 * 1000,
  });

  // Now that the new one exists, the one it replaces has no purpose: this
  // build's deployment is about to become the live one.
  try {
    const after = await pruneSnapshots({ keep: 1, keepIds: [snapshotId] });
    console.log(
      `[snapshot] Nach dem Ziehen aufgeräumt: ${after.deleted.length} gelöscht, ${after.kept.length} behalten`,
    );
  } catch {
    // The next build's prune will catch it.
  }

  // Remembered under the fingerprint as well, so the next deployment that
  // changes nothing about the video reuses this image instead of paying for a
  // second copy of it.
  await put(
    fingerprintBlobKey(fingerprint),
    JSON.stringify({ snapshotId, at: new Date().toISOString() }),
    {
      access: process.env.BLOB_ACCESS === "private" ? "private" : "public",
      contentType: "application/json",
      addRandomSuffix: false,
      allowOverwrite: true,
      token: blobToken,
    },
  );

  await put(snapshotBlobKey(), JSON.stringify({ snapshotId, fingerprint }), {
    access: process.env.BLOB_ACCESS === "private" ? "private" : "public",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
    token: blobToken,
  });

  console.log(`[snapshot] Gespeichert: ${snapshotId}`);
}

/**
 * A failed snapshot must not fail the deployment.
 *
 * The snapshot is a render-time optimisation: it lets a render restore a
 * sandbox that already has Chromium and the bundle in it, instead of building
 * one from scratch. Nothing else in the application needs it. But because this
 * step ran as the second half of the build command, anything that went wrong
 * inside it — a sandbox the account would not grant, a transient API error —
 * took the whole deployment down with it, and every fix to every unrelated part
 * of the app was stuck behind it.
 *
 * So it now ends the same way the first-deploy skip does: loudly, and green.
 * The deployment lands, the app serves, and /api/render says plainly that the
 * snapshot is missing rather than the user finding a week-old build in
 * production and no explanation for it.
 */
main().catch(async (err) => {
  await recordFailure(err);
  console.error(
    [
      "[snapshot] ============================================================",
      "[snapshot] FEHLGESCHLAGEN — dieser Build bleibt trotzdem GRÜN.",
      `[snapshot] Grund: ${(err as Error)?.message ?? err}`,
      `[snapshot] Antwort der API: ${apiErrorDetail(err).body ?? "(keine)"}`,
      "[snapshot] Die App wird deployed und läuft. Was NICHT geht: rendern,",
      "[snapshot] bis dieser Schritt einmal durchläuft. /api/render sagt das.",
      "[snapshot] Häufigste Ursache: es wurde keine Sandbox gewährt, weil zu",
      "[snapshot] viele laufen. Vercel → Sandboxes prüfen und stoppen; der",
      "[snapshot] nächtliche Cron räumt sie ab jetzt selbst weg.",
      "[snapshot] ============================================================",
    ].join("\n"),
  );
  if (err instanceof Error && err.stack) console.error(err.stack);
  process.exit(0);
});
