import { renderMediaOnVercel } from "@remotion/vercel";
import type { AnyProject } from "../../../lib/formats";
import { compositionFor } from "../../../lib/formats";
import { renderBlobPath } from "../../../lib/projects";
import { BLOB_ACCESS, type RenderSegment } from "../../../lib/store";
import { restoreSnapshot } from "./restore-snapshot";

/**
 * Rendering a long video in pieces.
 *
 * Measured, not assumed: a Vercel sandbox is capped near forty-five minutes,
 * and this renderer manages about three frames a second on a film of drawn
 * stills. One pass therefore tops out around eight thousand frames — which is
 * exactly where a sixteen-minute video died, at 8,846 of 29,175 after
 * forty-nine minutes.
 *
 * So the frames are split and each piece gets its own sandbox. They run at the
 * same time rather than one after another, which is the whole point: nine
 * pieces of two minutes finish in the time one piece takes, instead of in nine
 * times as long. Afterwards one more sandbox joins them.
 *
 * Remotion has a flag for precisely this — `forSeamlessAacConcatenation` — and
 * without it the audio of every piece would be padded to a frame boundary and
 * the joins would click.
 */

/**
 * Frames per piece.
 *
 * Ten minutes of video. At the measured 31 frames a second that is about five
 * minutes of rendering, so even a much slower film stays far inside the
 * forty-five minutes a sandbox gets.
 */
export const SEGMENT_FRAMES = 18_000;

/**
 * Below this, nothing is split — and that is now nearly everything.
 *
 * This number was 5,400 frames, and it was right for the machine we thought we
 * had: two cores, three frames a second, a single pass topping out near four
 * minutes of video. Then it turned out the render sandbox had been asking for
 * no cores at all and getting the default; with eight it manages 31 frames a
 * second, measured on the same film.
 *
 * At that rate a twenty-five minute video renders in twenty-four minutes —
 * inside the cap, in ONE pass, with no pieces to join. Which matters, because
 * joining is where this went wrong: nine pieces of a sixteen-minute film
 * rendered in twelve minutes and then sat for four hours in a stitch that
 * moved a gigabyte through a sandbox and never finished.
 *
 * So the split stays, for films longer than a sandbox can manage, and stops
 * being the path everything takes. The simplest thing that works is one pass.
 */
export const SPLIT_ABOVE = 40_000;

export function planSegments(totalFrames: number): { from: number; to: number }[] {
  if (totalFrames <= SPLIT_ABOVE) return [];

  const count = Math.ceil(totalFrames / SEGMENT_FRAMES);
  const per = Math.ceil(totalFrames / count);
  const plan: { from: number; to: number }[] = [];
  for (let i = 0; i < count; i++) {
    const from = i * per;
    if (from >= totalFrames) break;
    plan.push({ from, to: Math.min(totalFrames - 1, from + per - 1) });
  }
  return plan;
}

/** Where a piece lands in storage. Its own folder, swept with the render. */
export const segmentPath = (renderId: string, index: number) =>
  `renders/${renderId}/part-${String(index).padStart(3, "0")}.mp4`;

/**
 * Start every piece at once, each in its own sandbox.
 *
 * Restored in parallel too: booting nine sandboxes one after another would
 * spend most of the route's two minutes waiting rather than starting work.
 */
export async function startSegments(args: {
  renderId: string;
  project: AnyProject;
  ranges: { from: number; to: number }[];
  blobToken: string;
}): Promise<{ segments: RenderSegment[]; lifetimeMs: number }> {
  const started = await Promise.all(
    args.ranges.map(async (range, index) => {
      const { sandbox, lifetimeMs } = await restoreSnapshot();
      const path = segmentPath(args.renderId, index);

      const { sandboxId, cmdId } = await renderMediaOnVercel({
        sandbox,
        detached: true,
        compositionId: compositionFor(args.project),
        inputProps: { project: args.project },
        frameRange: [range.from, range.to],
        // Same reasoning as the single-pass route: a stills film does not need
        // eight megabits, and every megabyte here is moved twice — once to
        // storage, once back into the sandbox that joins the pieces.
        crf: 24,
        // Without this the audio of each piece is padded out to a frame
        // boundary, and every join would click audibly.
        forSeamlessAacConcatenation: true,
        vercelBlob: {
          blobToken: args.blobToken,
          access: BLOB_ACCESS,
          blobPath: path,
        },
      });

      return {
        segment: {
          index,
          from: range.from,
          to: range.to,
          sandboxId,
          cmdId,
          path,
        } satisfies RenderSegment,
        lifetimeMs,
      };
    }),
  );

  return {
    segments: started.map((s) => s.segment),
    lifetimeMs: started[0]?.lifetimeMs ?? 0,
  };
}

/**
 * Join the pieces into one file — detached, inside the sandbox.
 *
 * It used to run as a background task of the progress route, and that could
 * not work: such a task is killed after five minutes, so a join that had to
 * pull a gigabyte through the network died halfway and left the render sitting
 * at "Teile werden verbunden" with nobody to notice. So the whole job — fetch,
 * concatenate, upload — is one detached command in the sandbox, exactly the way
 * the render itself already worked.
 *
 * ffmpeg is not on the PATH, but Remotion ships a real one inside its
 * compositor package; the concat demuxer with `-c copy` rewraps the streams
 * without re-encoding. The upload uses the sandbox's own upload-blob.mjs, which
 * takes its configuration as a JSON argument.
 */
export async function startStitch(args: {
  renderId: string;
  segments: RenderSegment[];
  blobToken: string;
}): Promise<{ sandboxId: string; cmdId: string }> {
  const urls = args.segments
    .slice()
    .sort((a, b) => a.index - b.index)
    .map((s) => s.url)
    .filter((u): u is string => Boolean(u));

  if (urls.length !== args.segments.length) {
    throw new Error("Nicht alle Teile sind fertig — nichts zu verbinden.");
  }

  const { sandbox } = await restoreSnapshot();
  const dir = "/vercel/sandbox/stitch";

  // Absolute paths throughout, and that is not tidiness: the concat demuxer
  // resolves the entries of its list relative to the directory the LIST is in,
  // so a list in parts/ naming "parts/000.mp4" sends ffmpeg looking for
  // parts/parts/000.mp4. That broke every join.
  const upload = JSON.stringify({
    sandboxFilePath: `${dir}/stitched.mp4`,
    blobPath: renderBlobPath(args.renderId),
    access: BLOB_ACCESS,
    contentType: "video/mp4",
    blobToken: args.blobToken,
  });

  const script = [
    "set -e",
    `rm -rf ${dir} && mkdir -p ${dir}`,
    ...urls.map(
      (url, i) =>
        `curl -fsSL '${url}' -o ${dir}/${String(i).padStart(3, "0")}.mp4`,
    ),
    `for f in ${dir}/*.mp4; do echo "file '$f'" >> ${dir}/list.txt; done`,
    "FF=$(ls /vercel/sandbox/node_modules/@remotion/compositor-linux-*/ffmpeg 2>/dev/null | head -1)",
    '[ -n "$FF" ] || { echo "kein ffmpeg im Compositor-Paket" >&2; exit 1; }',
    `"$FF" -y -f concat -safe 0 -i ${dir}/list.txt -c copy ${dir}/stitched.mp4`,
    `node /vercel/sandbox/upload-blob.mjs '${upload.replace(/'/g, "'\\''")}'`,
  ].join("\n");

  const cmd = await sandbox.runCommand({
    cmd: "sh",
    args: ["-lc", script],
    detached: true,
  });

  return { sandboxId: sandbox.sandboxId, cmdId: cmd.cmdId };
}
