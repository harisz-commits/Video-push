import type { SceneType } from "../../lib/schema";

/**
 * The object a scene is entered and left through.
 *
 * The reference never cuts; it pushes the camera into something on screen
 * until that something fills the frame, and opens the next shot out of the
 * same colour. To do that, two consecutive scenes have to agree on one point
 * and one colour — the outgoing scene converges on it, the incoming one
 * emerges from it. That shared thing is what this file calls a portal.
 *
 * The position is per scene type, because each type knows where its own
 * subject sits: a counter's is the number in the middle, a narrator's is the
 * figure on the left, a stage's is the focus figure standing on the ground
 * line. Pushing into empty background would be a zoom, not a match cut.
 */
export type Portal = {
  /** Percentage across the frame. */
  x: number;
  /** Percentage down the frame. */
  y: number;
  color: string;
};

/** Where the subject of each scene type actually sits. */
const WHERE: Record<SceneType, { x: number; y: number }> = {
  hook: { x: 50, y: 46 },
  counter: { x: 50, y: 50 },
  iconGrid: { x: 32, y: 54 },
  mapFlow: { x: 50, y: 50 },
  chain: { x: 50, y: 52 },
  split: { x: 50, y: 50 },
  chart: { x: 50, y: 56 },
  pillars: { x: 50, y: 62 },
  narrator: { x: 22, y: 50 },
  stage: { x: 32, y: 70 },
  closer: { x: 50, y: 48 },
};

/**
 * Near-black rather than the scene's own background.
 *
 * The colour has to be darker than the frame it swallows, or the fill reads as
 * a fade rather than as the inside of an object. Every fourth cut goes through
 * the accent instead, so five minutes of this does not become one effect.
 */
const VOID = "#04070B";

export function portalFor(type: SceneType, index: number, accent: string): Portal {
  const where = WHERE[type] ?? { x: 50, y: 50 };
  return { ...where, color: index % 4 === 3 ? accent : VOID };
}

/** Radius that just covers the frame from a point, in pixels. */
export function coveringRadius(
  portal: Portal,
  width: number,
  height: number,
): number {
  const px = (portal.x / 100) * width;
  const py = (portal.y / 100) * height;
  return Math.max(
    Math.hypot(px, py),
    Math.hypot(width - px, py),
    Math.hypot(px, height - py),
    Math.hypot(width - px, height - py),
  );
}
