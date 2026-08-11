import type { FigureAction } from "../../../lib/schema";
import type { FigureProps } from "./Figure";

/**
 * The vocabulary of things a figure can do.
 *
 * Rigged rather than animated, which is the reference's own trick: a small set
 * of readable actions rather than fluid motion nobody could author at forty
 * scenes per film. Each action is a pure function of the frame, so a figure is
 * deterministic and two figures given different offsets never march in step.
 *
 * The walk cycle is the reason this file exists at all. Everything else is a
 * held pose that settles and stops; walking and running have to keep going for
 * as long as the shot lasts, and they have to drive the legs, the arms and the
 * body's bob from one phase so the parts stay in agreement.
 */

export type Pose = Pick<
  FigureProps,
  | "armLeft"
  | "armRight"
  | "legLeft"
  | "legRight"
  | "headTurn"
  | "tilt"
  | "shrug"
  | "bob"
  | "sway"
> & {
  /** How far across the frame the figure has travelled, in body widths. */
  travel: number;
};

const REST: Pose = {
  armLeft: 0,
  armRight: 0,
  legLeft: 0,
  legRight: 0,
  headTurn: 0,
  tilt: 0,
  shrug: 0,
  bob: 0,
  sway: 0,
  travel: 0,
};

/** A stride: legs opposed, arms counter-swinging, body rising twice a step. */
function stride(frame: number, speed: number, reach: number): Pose {
  const phase = frame * speed;
  const swing = Math.sin(phase) * reach;

  return {
    ...REST,
    legLeft: swing,
    legRight: -swing,
    // Arms oppose the legs, which is what makes a walk read as a walk.
    armLeft: 0.18 + 0.22 * (-Math.sin(phase) + 1) * reach,
    armRight: 0.18 + 0.22 * (Math.sin(phase) + 1) * reach,
    bob: -Math.abs(Math.cos(phase)) * 6 * reach,
    tilt: reach > 0.4 ? 6 : 2, // a run leans into itself
    travel: frame * speed * (reach > 0.4 ? 3.4 : 1.9),
  };
}

/**
 * @param frame  Scene-relative frame.
 * @param settle 0..1 driver for actions that strike a pose and hold it.
 * @param idle   Baseline arm drift, so a standing figure is never rigid.
 */
export function poseFor(
  action: FigureAction,
  frame: number,
  settle: number,
  idle: number,
): Pose {
  switch (action) {
    case "walk":
      return stride(frame, 0.16, 0.3);
    case "run":
      return stride(frame, 0.32, 0.55);

    case "point":
      return {
        ...REST,
        armLeft: idle * 0.4,
        armRight: idle + (1 - idle) * settle,
        headTurn: 4 * settle,
      };

    case "shake":
      // Slow no, damped back to centre rather than shaking forever.
      return {
        ...REST,
        armLeft: idle,
        armRight: idle,
        headTurn: 7 * settle * Math.sin(frame / 7) * Math.exp(-frame / 90),
      };

    case "shrug":
      return {
        ...REST,
        armLeft: 0.35 + 0.25 * settle,
        armRight: 0.35 + 0.25 * settle,
        shrug: settle,
      };

    case "cheer":
      return {
        ...REST,
        armLeft: 0.7 + 0.3 * settle,
        armRight: 0.7 + 0.3 * settle,
        // A small hop, not a jump — the figure celebrates, it does not levitate.
        bob: -8 * Math.abs(Math.sin(frame / 9)) * settle,
      };

    case "fall":
      return {
        ...REST,
        tilt: 78 * settle,
        armLeft: 0.5 * settle,
        armRight: 0.65 * settle,
        legLeft: 0.4 * settle,
        legRight: -0.25 * settle,
      };

    case "stand":
      return { ...REST, armLeft: idle * 0.8, armRight: idle, sway: 0 };

    case "talk":
    default:
      return { ...REST, armLeft: idle, armRight: idle * 1.15 };
  }
}
