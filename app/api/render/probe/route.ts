import { errorResponse } from "../../../../lib/guardrails";
import { restoreSnapshot } from "../restore-snapshot";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * What tools the render sandbox actually has.
 *
 * Written for one decision: rendering a long video in sections only works if
 * the sections can be joined again, and joining MP4s needs ffmpeg. Whether the
 * snapshot has one is a fact about the image, not something to assume — and
 * assuming it would mean building the whole sectioned renderer before finding
 * out it cannot finish.
 *
 * Boots a sandbox, asks, and stops it again.
 */
export async function GET() {
  let sandbox: Awaited<ReturnType<typeof restoreSnapshot>>["sandbox"] | null =
    null;
  try {
    const restored = await restoreSnapshot();
    sandbox = restored.sandbox;

    const probes: Record<string, string> = {};
    const checks: [string, string][] = [
      ["ffmpeg", "ffmpeg -version 2>&1 | head -1 || echo FEHLT"],
      ["ffprobe", "ffprobe -version 2>&1 | head -1 || echo FEHLT"],
      [
        "compositor",
        "ls node_modules/@remotion/compositor-linux-x64-gnu/ 2>/dev/null | head -5 || echo FEHLT",
      ],
      ["node", "node --version"],
      ["paket", "command -v dnf yum apt-get microdnf 2>/dev/null || echo keiner"],
      ["cwd", "pwd && ls | head -10"],
      // What the machine actually is. The render is almost entirely CPU work
      // — Remotion paints frames in parallel Chromium tabs and then encodes —
      // so cores and clock are the whole story when comparing this against
      // any other host.
      ["kerne", "nproc"],
      ["cpu", "grep -m1 'model name' /proc/cpuinfo | cut -d: -f2"],
      ["ram", "free -m | awk '/Mem:/ {print $2\" MB\"}'"],
      ["last", "uptime"],
    ];
    for (const [name, script] of checks) {
      const done = await sandbox.runCommand("sh", ["-lc", script]);
      probes[name] = (await done.stdout()).trim().slice(0, 300);
    }

    return Response.json({ probes });
  } catch (err) {
    return errorResponse((err as Error).message.slice(0, 400), 500);
  } finally {
    await sandbox?.stop().catch(() => undefined);
  }
}
