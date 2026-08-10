import { readFileSync } from "fs";
import { resolveSceneTimings } from "../lib/align";
import { VideoProject } from "../lib/schema";

const project = VideoProject.parse(
  JSON.parse(readFileSync("/tmp/project.json", "utf8")),
);
const t = resolveSceneTimings(project);

console.log(`Audio ${t.audioDurationSeconds.toFixed(1)}s -> ${t.totalFrames} Frames (${(t.totalFrames/30).toFixed(1)}s)`);
console.log(`geschätzt: ${t.estimated} | Warnungen: ${t.warnings.length}`);
for (const w of t.warnings) console.log("  ⚠", w.sceneId, w.message);
console.log();
let prevEnd = 0, gaps = 0;
for (const s of t.scenes) {
  if (s.from !== prevEnd) gaps++;
  prevEnd = s.from + s.durationInFrames;
  const m = Math.floor(s.startSeconds / 60);
  const sec = (s.startSeconds % 60).toFixed(1).padStart(4, "0");
  console.log(`${s.id} ${s.type.padEnd(9)} ${m}:${sec}  ${(s.durationInFrames/30).toFixed(1).padStart(5)}s  ${s.anchorResolved ? "anker ok" : "INTERPOLIERT"}`);
}
console.log(`\nLücken: ${gaps} | endet Frame ${prevEnd} von ${t.totalFrames}`);
