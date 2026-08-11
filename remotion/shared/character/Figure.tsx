import React from "react";
import { C } from "../Tokens";
import type { Viseme } from "../visemes";

/**
 * A person.
 *
 * Drawn to the same rules as the icon set — 2px strokes, flat fill, no
 * gradients, no shadows — because a character in a different visual language
 * would read as clip art dropped into someone else's film.
 *
 * Everything that moves is a prop. The component holds no state and reads no
 * clock, so the same frame number always produces the same drawing and the
 * figure can be placed in a talking-head shot or a running crowd without
 * knowing the difference.
 */

/** Mouth geometry per shape, on the 200-wide body grid. */
const MOUTHS: Record<Viseme, { d: string; fill: boolean }> = {
  rest: { d: "M88 106 Q100 110 112 106", fill: false },
  closed: { d: "M87 106 L113 106", fill: false },
  open: { d: "M88 100 Q100 118 112 100 Q100 108 88 100 Z", fill: true },
  wide: { d: "M84 103 Q100 113 116 103 Q100 108 84 103 Z", fill: true },
  round: { d: "M92 104 a8 7 0 1 0 16 0 a8 7 0 1 0 -16 0 Z", fill: true },
  small: { d: "M95 105 a5 4 0 1 0 10 0 a5 4 0 1 0 -10 0 Z", fill: true },
  teeth: { d: "M88 104 Q100 100 112 104 L112 108 Q100 111 88 108 Z", fill: true },
};

const HIP_Y = 268;
const SHOULDER_Y = 198;
/** Where the feet meet the ground, on the body grid. */
const FOOT_Y = 368;

/**
 * An arm, as one number.
 *
 * 0 hangs at the side, 1 is extended out and up. Every pose is some value of
 * this on each side, which keeps poses to a single interpolation instead of a
 * set of drawn shapes that would jump between each other.
 */
function arm(lift: number, mirror: boolean): string {
  const lerp = (a: number, b: number) => a + (b - a) * lift;
  const shoulderX = mirror ? 58 : 142;
  const dir = mirror ? -1 : 1;

  const controlX = shoulderX + dir * lerp(18, 30);
  const controlY = lerp(218, 190);
  const handX = shoulderX + dir * lerp(14, 56);
  const handY = lerp(240, 178);

  return `M${shoulderX} ${SHOULDER_Y} Q${controlX} ${controlY} ${handX} ${handY}`;
}

/**
 * A leg, as a swing angle in radians.
 *
 * Two segments with a knee that bends on the forward swing — a straight line
 * pivoting from the hip reads as a compass needle, not a step.
 */
function leg(swing: number, mirror: boolean): string {
  const hipX = mirror ? 86 : 114;
  const thigh = 52;
  const shin = 50;

  const kneeX = hipX + Math.sin(swing) * thigh;
  const kneeY = HIP_Y + Math.cos(swing) * thigh;

  // The trailing leg bends, the leading one straightens.
  const bend = Math.max(0, -swing) * 0.9;
  const shinAngle = swing * 0.35 - bend;
  const footX = kneeX + Math.sin(shinAngle) * shin;
  const footY = kneeY + Math.cos(shinAngle) * shin;

  return `M${hipX} ${HIP_Y} L${kneeX} ${kneeY} L${footX} ${footY}`;
}

export type FigureProps = {
  viseme?: Viseme;
  /** 0 = eyes open, 1 = fully shut. */
  blink?: number;
  /** Radians of gentle sway. */
  sway?: number;
  /** 0 = arms down, 1 = extended. */
  armLeft?: number;
  armRight?: number;
  /** Radians each leg swings from vertical. */
  legLeft?: number;
  legRight?: number;
  /** Degrees the head turns — a shake is this oscillating. */
  headTurn?: number;
  /** Degrees the whole body tips. A fall is this near ninety. */
  tilt?: number;
  /** 0 = shoulders relaxed, 1 = raised. */
  shrug?: number;
  /** Vertical bob, in body units. */
  bob?: number;
  /** Cut at the waist for a talking-head shot, or draw the whole person. */
  crop?: "bust" | "full";
  accent: string;
  /** Height in pixels. Width follows from the crop. */
  height?: number;
};

export const Figure: React.FC<FigureProps> = ({
  viseme = "rest",
  blink = 0,
  sway = 0,
  armLeft = 0,
  armRight = 0,
  legLeft = 0,
  legRight = 0,
  headTurn = 0,
  tilt = 0,
  shrug = 0,
  bob = 0,
  crop = "full",
  accent,
  height = 360,
}) => {
  const mouth = MOUTHS[viseme];
  const eyeHeight = 1 - blink;
  // Brows follow whatever the body is doing — a raised arm without a raised
  // brow reads as a puppet.
  const brow = Math.max(shrug, (armLeft + armRight) / 2);

  // A bust keeps the head large in frame; the full body needs the legs.
  const box = crop === "bust" ? { y: 30, h: 250 } : { y: 20, h: 370 };
  const width = height * (200 / box.h);

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 ${box.y} 200 ${box.h}`}
      fill="none"
      style={{ overflow: "visible" }}
    >
      {/*
        A body tips about its feet, not its waist. Pivoting at the hip left a
        fallen figure floating horizontally in mid-air with its feet in the
        sky; pivoting at the floor lays it down where it actually lands.
      */}
      <g
        transform={`rotate(${tilt} 100 ${crop === "bust" ? HIP_Y : FOOT_Y}) translate(0 ${bob})`}
      >
        <g transform={`rotate(${sway * 1.6} 100 ${HIP_Y})`}>
          {crop === "full" ? (
            <g
              stroke={accent}
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            >
              <path d={leg(legLeft, true)} />
              <path d={leg(legRight, false)} />
            </g>
          ) : null}

          {/* Torso — rises a little with the shoulders on a shrug. */}
          <path
            transform={`translate(0 ${-6 * shrug})`}
            d={`M60 ${HIP_Y} V196 Q60 168 100 168 Q140 168 140 196 V${HIP_Y} Z`}
            fill={C.bgAlt}
            stroke={accent}
            strokeWidth={2.5}
            strokeLinejoin="round"
          />
          <path
            d="M84 170 L100 186 L116 170"
            stroke={accent}
            strokeWidth={2.5}
            strokeLinecap="round"
            fill="none"
          />

          {/* Arms — one number each, so every pose is the same interpolation. */}
          <g
            stroke={accent}
            strokeWidth={2.5}
            strokeLinecap="round"
            fill="none"
            transform={`translate(0 ${-6 * shrug})`}
          >
            <path d={arm(armLeft, true)} />
            <path d={arm(armRight, false)} />
          </g>

          <g
            transform={`rotate(${sway * 2.6 + headTurn} 100 160) translate(0 ${-6 * shrug})`}
          >
            <path
              d="M100 168 V152"
              stroke={accent}
              strokeWidth={2.5}
              strokeLinecap="round"
            />
            <rect
              x="62"
              y="56"
              width="76"
              height="96"
              rx="34"
              fill={C.bgAlt}
              stroke={accent}
              strokeWidth={2.5}
            />
            <path
              d="M62 92 Q64 52 100 52 Q136 52 138 92 Q126 74 100 74 Q74 74 62 92 Z"
              fill={accent}
              fillOpacity={0.9}
              stroke="none"
            />

            {/* Eyes — scaled vertically so a blink is a squeeze, not a jump. */}
            <g fill={C.ink}>
              <ellipse cx="84" cy="92" rx="4.5" ry={4.5 * eyeHeight + 0.4} />
              <ellipse cx="116" cy="92" rx="4.5" ry={4.5 * eyeHeight + 0.4} />
            </g>
            <g stroke={C.ink} strokeWidth={2} strokeLinecap="round" opacity={0.75}>
              <path d={`M77 ${82 - brow * 2} Q84 ${78 - brow * 3} 91 ${82 - brow * 2}`} />
              <path d={`M109 ${82 - brow * 2} Q116 ${78 - brow * 3} 123 ${82 - brow * 2}`} />
            </g>

            <path
              d={mouth.d}
              fill={mouth.fill ? C.signal : "none"}
              fillOpacity={mouth.fill ? 0.85 : 0}
              stroke={C.ink}
              strokeWidth={2.2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </g>
        </g>
      </g>
    </svg>
  );
};
