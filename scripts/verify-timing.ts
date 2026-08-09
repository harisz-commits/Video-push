import { readFileSync } from "fs";
import { resolveSceneTimings, wordsFromAlignment } from "../lib/align";
import { VideoProject } from "../lib/schema";

const seed = VideoProject.parse(
  JSON.parse(readFileSync("data/europa.json", "utf8")),
);

// Fabricate an ElevenLabs-shaped alignment: ~14.5 chars/second, which is
// roughly a German TTS delivery at 160 wpm.
const CPS = 14.5;
const characters = [...seed.voiceover];
const startTimesSeconds = characters.map((_, i) => i / CPS);
const endTimesSeconds = characters.map((_, i) => (i + 1) / CPS);

const withAudio = {
  ...seed,
  audioUrl: "https://example.com/a.mp3",
  alignment: { characters, startTimesSeconds, endTimesSeconds },
};

const timing = resolveSceneTimings(withAudio);
console.log(`Audio: ${timing.audioDurationSeconds.toFixed(1)}s | Gesamt: ${timing.totalFrames} Frames (${(timing.totalFrames / 30).toFixed(1)}s)`);
console.log(`Warnungen: ${timing.warnings.length}`);
for (const w of timing.warnings) console.log("  ⚠", w.sceneId, w.message);

console.log("\nid   typ        start    dauer  anker");
for (const s of timing.scenes) {
  const m = Math.floor(s.startSeconds / 60);
  const sec = (s.startSeconds % 60).toFixed(1).padStart(4, "0");
  console.log(
    `${s.id}  ${s.type.padEnd(9)}  ${m}:${sec}  ${String((s.durationInFrames / 30).toFixed(1)).padStart(5)}s  ${s.anchorResolved ? "ok" : "INTERPOLIERT"}`,
  );
}

// Monotonic + gapless check
let prevEnd = 0;
let contiguous = true;
for (const s of timing.scenes) {
  if (s.from !== prevEnd) contiguous = false;
  prevEnd = s.from + s.durationInFrames;
}
console.log(`\nLückenlos aneinander: ${contiguous ? "ja" : "NEIN"}`);
console.log(`Endet bei Frame ${prevEnd}, totalFrames ${timing.totalFrames}`);

const words = wordsFromAlignment(withAudio.alignment);
console.log(`\nWörter aus Alignment: ${words.length} (erwartet ${seed.voiceover.trim().split(/\s+/).length})`);
console.log(`Erstes Wort: "${words[0].word}" @ ${words[0].start.toFixed(2)}s`);
console.log(`Letztes Wort: "${words[words.length - 1].word}" @ ${words[words.length - 1].start.toFixed(2)}s`);

// A missing anchor must warn, not crash.
const broken = {
  ...withAudio,
  scenes: withAudio.scenes.map((s, i) =>
    i === 4 ? { ...s, anchorPhrase: "diese Phrase gibt es nicht" } : s,
  ),
};
const brokenTiming = resolveSceneTimings(broken as typeof withAudio);
console.log(`\nMit kaputtem Anker: ${brokenTiming.warnings.length} Warnung(en), ${brokenTiming.scenes.length} Szenen, kein Crash.`);
console.log("  ->", brokenTiming.warnings[0]?.message);
