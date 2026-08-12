import React from "react";
import { Audio, Sequence, staticFile } from "remotion";
import type { QuizLevel, QuizTiming } from "../../lib/quiz";
import { BED_SECONDS } from "./levels";

/**
 * The quiz soundtrack.
 *
 * The reference format is carried by its audio more than by its pictures: a
 * clock you can hear, a reward you can hear, and music that never stops. So
 * this is not decoration laid over a finished video — the tick is the timer,
 * and muting it would remove the tension the whole format runs on.
 *
 * Levels are quoted here rather than in each component so the mix is one
 * readable list instead of numbers scattered across a dozen files.
 */
const LEVEL = {
  /**
   * The music.
   *
   * Higher than the infographics bed's 0.26, and it should be: this format has
   * no narration for the music to stay out of the way of, and a gameshow bed
   * that stays out of the way is not doing its job. Set against measurement —
   * the mix is checked after rendering rather than guessed at.
   */
  bed: 0.45,
  tick: 0.34,
  tickUrgent: 0.5,
  ding: 0.62,
  buzz: 0.22,
  whoosh: 0.45,
} as const;

const FPS = 30;

export const QuizSound: React.FC<{ timing: QuizTiming; fps: number }> = ({
  timing,
  fps,
}) => (
  <>
    <QuizBed timing={timing} fps={fps} />
    {timing.slots.map((slot) => (
      <SlotSound key={slot.question.id} slot={slot} fps={fps} />
    ))}
  </>
);

/**
 * The music, laid out as explicit repeats per run of one difficulty.
 *
 * Not `<Loop>`: a volume callback inside one is handed the frame within the
 * current repetition rather than within the whole span, so any fade restarts
 * on every pass. Placing the repeats by hand is duller and correct.
 */
const QuizBed: React.FC<{ timing: QuizTiming; fps: number }> = ({
  timing,
  fps,
}) => {
  // The music follows position in the video, not the difficulty of whatever
  // question is on screen.
  //
  // It used to follow the question, which was right while the questions climbed
  // in order and became nonsense once they were mixed: the bed would have
  // changed tempo and key every few seconds, restarting on each switch. The
  // escalation the format wants is a property of the video, not of the current
  // question — so the tempo climbs steadily from start to finish while the
  // questions jump around on top of it.
  const stages: QuizLevel[] = ["easy", "medium", "hard", "impossible"];
  const runs: { level: QuizLevel; from: number; to: number }[] = stages.map(
    (level, i) => ({
      level,
      from: Math.round((timing.totalFrames * i) / stages.length),
      to: Math.round((timing.totalFrames * (i + 1)) / stages.length),
    }),
  );

  return (
    <>
      {runs.map((run, r) => {
        const loopFrames = Math.round(BED_SECONDS[run.level] * fps);
        const repeats = Math.ceil((run.to - run.from) / loopFrames);
        return Array.from({ length: repeats }, (_, k) => {
          const from = run.from + k * loopFrames;
          const duration = Math.min(loopFrames, run.to - from);
          if (duration <= 0) return null;
          return (
            <Sequence
              key={`${r}-${k}`}
              from={from}
              durationInFrames={duration}
              name={`♪ ${run.level} ${k + 1}`}
            >
              <Audio
                src={staticFile(`audio/q-bed-${run.level}.wav`)}
                volume={LEVEL.bed}
              />
            </Sequence>
          );
        });
      })}
    </>
  );
};

/**
 * One question's sounds.
 *
 * The ticks are placed one per second of the think phase and doubled for the
 * last two, which is the audible version of the bar turning red — the same
 * information twice, because a viewer looking away still has to feel the clock
 * running out.
 */
const SlotSound: React.FC<{
  slot: QuizTiming["slots"][number];
  fps: number;
}> = ({ slot, fps }) => {
  // Every offset below is added to the slot's own start. It was not, and the
  // result was not subtle: slot-relative frames mounted at the composition
  // root fired every tick and every ding of all twelve questions inside the
  // first ten seconds, after which the video ran two minutes on music alone.
  // Measured before it could be heard — seconds 5 to 9 carried four times the
  // energy of everything after them.
  const bodyFrom = slot.from + slot.levelCardFrames;
  const thinkFrom = bodyFrom + slot.enterFrames;
  const revealAt = thinkFrom + slot.thinkFrames;
  const thinkSeconds = slot.thinkFrames / fps;

  const ticks: { at: number; urgent: boolean }[] = [];
  for (let second = 0; second < thinkSeconds; second++) {
    const urgent = thinkSeconds - second <= 2;
    ticks.push({ at: thinkFrom + Math.round(second * fps), urgent });
    if (urgent) {
      ticks.push({ at: thinkFrom + Math.round((second + 0.5) * fps), urgent });
    }
  }

  return (
    <>
      {/* The question arriving. */}
      <One at={bodyFrom} file="q-whoosh" volume={LEVEL.whoosh} />

      {ticks.map((t, i) => (
        <One
          key={i}
          at={t.at}
          file={t.urgent ? "q-tick-urgent" : "q-tick"}
          volume={t.urgent ? LEVEL.tickUrgent : LEVEL.tick}
        />
      ))}

      {/* The answer. */}
      <One at={revealAt} file="q-ding" volume={LEVEL.ding} />
      {/* And the two being struck out, a beat later so it is a second event. */}
      <One at={revealAt + 5} file="q-buzz" volume={LEVEL.buzz} />

      {/* The wipe into the next question. */}
      <One
        at={slot.from + slot.durationInFrames - slot.exitFrames}
        file="q-whoosh"
        volume={LEVEL.whoosh}
      />
    </>
  );
};

/**
 * A single sound at a single frame.
 *
 * Given a generous duration rather than its exact length: a Sequence that ends
 * before the file does cuts the tail off, and a click at the end of every tick
 * is worse than a few unused frames.
 */
const One: React.FC<{ at: number; file: string; volume: number }> = ({
  at,
  file,
  volume,
}) => (
  <Sequence from={Math.max(0, at)} durationInFrames={2 * FPS} name={`♪ ${file}`}>
    <Audio src={staticFile(`audio/${file}.wav`)} volume={volume} />
  </Sequence>
);
