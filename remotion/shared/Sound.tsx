import React from "react";
import { Audio, Sequence, staticFile, useVideoConfig } from "remotion";
import type { Phase } from "./SceneShell";

/**
 * The audio layer.
 *
 * Two things live here: one-shot cues fired by scenes, and the music bed that
 * runs under the entire film. Everything they play is synthesised by
 * scripts/make-audio.ts, so there are no licences and no downloads.
 *
 * Levels are set once, here, rather than per call site. A cue that is loud in
 * one scene and quiet in the next is the sort of thing nobody notices while
 * building and everybody notices while watching.
 */

export type CueName =
  | "pop"
  | "swoosh"
  | "impact"
  | "rumble"
  | "kaching"
  | "glitch"
  | "tick"
  | "riser"
  | "transition";

/** Set against the voiceover at 1.0. The voice always wins. */
const LEVEL: Record<CueName, number> = {
  pop: 0.3,
  swoosh: 0.24,
  impact: 0.42,
  rumble: 0.34,
  kaching: 0.34,
  glitch: 0.3,
  tick: 0.16,
  riser: 0.36,
  transition: 0.3,
};

/** Longest each cue can run, so a Sequence can be bounded. */
const SECONDS: Record<CueName, number> = {
  pop: 0.14,
  swoosh: 0.38,
  impact: 0.55,
  rumble: 1.6,
  kaching: 0.75,
  glitch: 0.45,
  tick: 0.05,
  riser: 2.0,
  transition: 0.6,
};

/** The cue a scene's `sfx` hint maps to. */
export const SFX_CUE = {
  money: "kaching",
  danger: "glitch",
  drop: "impact",
  reveal: "riser",
} as const satisfies Record<string, CueName>;

/**
 * One cue, fired `at` a frame relative to the surrounding Sequence.
 *
 * Negative or out-of-range frames are dropped rather than clamped: a cue that
 * slides to frame 0 because its trigger was off-screen is worse than silence,
 * since several of them then land on the same frame and add up into a click.
 */
export const Cue: React.FC<{
  name: CueName;
  at: number;
  /** Multiplied with the cue's standard level. */
  gain?: number;
}> = ({ name, at, gain = 1 }) => {
  const { fps } = useVideoConfig();
  if (!Number.isFinite(at) || at < 0) return null;

  return (
    <Sequence
      from={Math.round(at)}
      durationInFrames={Math.ceil(SECONDS[name] * fps) + 1}
      layout="none"
      name={`♪ ${name}`}
    >
      <Audio src={staticFile(`audio/${name}.wav`)} volume={LEVEL[name] * gain} />
    </Sequence>
  );
};

/**
 * The bed: a dark synth loop that pulses like a countdown.
 *
 * It changes with the story rather than running as one texture — the crisis bed
 * is a bare fifth, the solution bed the same room lit differently — and the two
 * cross-fade across the turn instead of cutting, which would announce itself.
 */
const BED_SECONDS = 8;
const BED_LEVEL = 0.13;
const CROSSFADE = 30;

export const Soundtrack: React.FC<{
  totalFrames: number;
  /** Absolute frame of the first solution scene, or -1 if the film never turns. */
  turnFrame: number;
}> = ({ totalFrames, turnFrame }) => {
  const { fps } = useVideoConfig();
  const loopFrames = Math.round(BED_SECONDS * fps);
  const turns = turnFrame > 0 && turnFrame < totalFrames;

  /**
   * The repeats are laid out by hand rather than with `<Loop>`.
   *
   * A volume callback inside a Loop is handed the frame within the current
   * repetition, which restarts at zero every eight seconds — a fade written
   * against it would re-fade on every pass. Placing the repeats explicitly
   * keeps the absolute position available, which is the only thing a fade
   * across the whole span can be written against.
   */
  const bed = (phase: Phase, from: number, duration: number, fadeOut: boolean) => {
    if (duration <= 0) return null;
    const repeats = Math.ceil(duration / loopFrames);

    return Array.from({ length: repeats }, (_, k) => {
      const start = k * loopFrames;
      const length = Math.min(loopFrames, duration - start);
      if (length <= 0) return null;

      return (
        <Sequence
          key={`${phase}-${k}`}
          from={from + start}
          durationInFrames={length}
          layout="none"
          name={`♪ bed ${phase} ${k + 1}`}
        >
          <Audio
            src={staticFile(`audio/bed-${phase}.wav`)}
            volume={(frame) => {
              const at = start + frame; // position within this bed's whole span
              const rise = Math.min(1, at / CROSSFADE);
              const fall = fadeOut
                ? Math.min(1, Math.max(0, duration - at) / CROSSFADE)
                : 1;
              return BED_LEVEL * rise * fall;
            }}
          />
        </Sequence>
      );
    });
  };

  if (!turns) return <>{bed("crisis", 0, totalFrames, false)}</>;

  return (
    <>
      {bed("crisis", 0, turnFrame + CROSSFADE, true)}
      {bed("solution", turnFrame, totalFrames - turnFrame, false)}
    </>
  );
};
