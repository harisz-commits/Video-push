import { execSync } from "child_process";
import { readdirSync, statSync, unlinkSync } from "fs";
import { join } from "path";

/**
 * Bundles the Remotion project for the sandbox.
 *
 * Only used in local development. On Vercel the bundle is baked into a sandbox
 * snapshot at build time (see create-snapshot.ts), because bundling on every
 * render would add a minute to each one.
 */
export function bundleRemotionProject(bundleDir: string): void {
  try {
    execSync(`node_modules/.bin/remotion bundle --out-dir ./${bundleDir}`, {
      cwd: process.cwd(),
      stdio: "inherit",
    });
  } catch (e) {
    const stderr = (e as { stderr?: Buffer }).stderr?.toString() ?? "";
    throw new Error(`Remotion bundle failed: ${stderr}`);
  }

  stripSourceMaps(bundleDir);
}

/**
 * Delete the source maps before the bundle is shipped to a sandbox.
 *
 * They are over half the bundle by weight — twelve megabytes of the
 * twenty-three — and they are uploaded in a single request together with
 * everything else. Nothing in a headless render sandbox will ever open a
 * source map: there is no debugger attached and no stack trace anybody reads.
 * The `sourceMappingURL` comments left behind in the JavaScript are harmless;
 * a missing map is simply not fetched.
 */
function stripSourceMaps(bundleDir: string): void {
  let removed = 0;
  let bytes = 0;

  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith(".map")) {
        bytes += statSync(full).size;
        unlinkSync(full);
        removed += 1;
      }
    }
  };

  try {
    walk(bundleDir);
  } catch {
    // A bundle without maps is the goal, not a requirement.
    return;
  }

  if (removed > 0) {
    console.log(
      `[bundle] ${removed} Source-Maps entfernt (${(bytes / 1e6).toFixed(1)} MB weniger Upload)`,
    );
  }
}

/** Directory @remotion/vercel unpacks the bundle into, inside the sandbox. */
const SANDBOX_BUNDLE_ROOT = "remotion-bundle";

/**
 * Create the bundle root before handing the bundle to @remotion/vercel.
 *
 * addBundleToSandbox() mkdirs every directory the bundle contains, one at a
 * time and not recursively, but it never creates the root those directories
 * live in. A flat bundle survives that because writeFiles creates missing
 * parents. Ours is not flat — public/fonts holds the self-hosted woff2 files —
 * so the very first mkdir asks for remotion-bundle/public while
 * remotion-bundle does not exist yet, and the sandbox answers
 * "No such file or directory".
 *
 * Creating the root first is enough: the library sorts the rest, so parents
 * always precede their children.
 */
export async function ensureSandboxBundleRoot(sandbox: {
  mkDir: (path: string) => Promise<void>;
}): Promise<void> {
  try {
    await sandbox.mkDir(SANDBOX_BUNDLE_ROOT);
  } catch {
    // Already present, which is fine — this only has to exist, not be new.
  }
}
