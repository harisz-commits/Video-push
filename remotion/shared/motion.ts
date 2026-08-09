import { spring } from "remotion";
import { T } from "./Tokens";

/**
 * The single motion primitive of this project.
 *
 * Everything scales out of 0.92 with opacity 0 -> 1. Nothing ever slides in
 * from outside the frame, and nothing uses a linear ease — the style lives on
 * precision, not on effects.
 */
export function enter(frame: number, fps: number, delay = 0) {
  const progress = spring({
    frame: frame - delay,
    fps,
    config: { damping: 200, stiffness: 100 },
    durationInFrames: T.enter,
  });

  return {
    progress,
    opacity: progress,
    scale: 0.92 + 0.08 * progress,
    style: {
      opacity: progress,
      transform: `scale(${0.92 + 0.08 * progress})`,
    } as const,
  };
}

/** Same curve, but returning only the 0..1 driver — for bespoke animations. */
export function drive(
  frame: number,
  fps: number,
  delay = 0,
  durationInFrames: number = T.enter,
) {
  return spring({
    frame: frame - delay,
    fps,
    config: { damping: 200, stiffness: 100 },
    durationInFrames,
  });
}

/** Staggered delay for the nth element of a group. */
export function stagger(index: number, step: number = T.stagger) {
  return index * step;
}
