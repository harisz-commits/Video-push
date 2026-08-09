import { execSync } from "child_process";

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
}
