import React from "react";
import { C } from "../Tokens";
import type { Viseme } from "../visemes";

/**
 * The narrator.
 *
 * Drawn to the same rules as the icon set — 2px strokes, flat fill, no
 * gradients, no shadows — because a character in a different visual language
 * would read as clip art dropped into someone else's film.
 *
 * Everything that moves is a prop: the mouth follows the voice, the eyes blink
 * on their own schedule, and the whole figure breathes. A face that holds one
 * expression is worse than no face at all.
 */

/** Mouth geometry per shape, on a 200x260 body grid. */
const MOUTHS: Record<Viseme, { d: string; fill: boolean }> = {
  rest: { d: "M88 106 Q100 110 112 106", fill: false },
  closed: { d: "M87 106 L113 106", fill: false },
  open: { d: "M88 100 Q100 118 112 100 Q100 108 88 100 Z", fill: true },
  wide: { d: "M84 103 Q100 113 116 103 Q100 108 84 103 Z", fill: true },
  round: { d: "M92 104 a8 7 0 1 0 16 0 a8 7 0 1 0 -16 0 Z", fill: true },
  small: { d: "M95 105 a5 4 0 1 0 10 0 a5 4 0 1 0 -10 0 Z", fill: true },
  teeth: { d: "M88 104 Q100 100 112 104 L112 108 Q100 111 88 108 Z", fill: true },
};

/**
 * An arm, as one number.
 *
 * 0 hangs at the side, 1 is extended out and up. Every pose the narrator can
 * strike is some value of this on each side, which keeps the poses to a single
 * interpolation instead of a set of hand-drawn paths that jump between each
 * other.
 */
function arm(lift: number, mirror: boolean): string {
  const lerp = (a: number, b: number) => a + (b - a) * lift;
  const shoulderX = mirror ? 58 : 142;
  const shoulderY = 198;
  const dir = mirror ? -1 : 1;

  const controlX = shoulderX + dir * lerp(18, 30);
  const controlY = lerp(218, 190);
  const handX = shoulderX + dir * lerp(14, 56);
  const handY = lerp(240, 178);

  return `M${shoulderX} ${shoulderY} Q${controlX} ${controlY} ${handX} ${handY}`;
}

export const Figure: React.FC<{
  viseme: Viseme;
  /** 0 = eyes open, 1 = fully shut. */
  blink: number;
  /** Radians of gentle sway, driven by the caller so it stays frame-exact. */
  sway: number;
  /** 0 = arms down, 1 = extended. Left and right move independently. */
  armLeft: number;
  armRight: number;
  /** Degrees the head turns — a shake is this oscillating. */
  headTurn: number;
  /** 0 = shoulders relaxed, 1 = raised. */
  shrug: number;
  accent: string;
  size?: number;
}> = ({
  viseme,
  blink,
  sway,
  armLeft,
  armRight,
  headTurn,
  shrug,
  accent,
  size = 520,
}) => {
  const mouth = MOUTHS[viseme];
  const eyeHeight = 1 - blink;
  // Brows follow whatever the body is doing — a raised arm without a raised
  // brow reads as a puppet.
  const brow = Math.max(shrug, (armLeft + armRight) / 2);

  return (
    <svg
      width={size}
      height={size * 1.3}
      viewBox="0 0 200 260"
      fill="none"
      style={{ overflow: "visible" }}
    >
      <g transform={`rotate(${sway * 1.6} 100 210)`}>
        {/* Torso — rises a little with the shoulders on a shrug. */}
        <path
          transform={`translate(0 ${-6 * shrug})`}
          d="M56 260 V196 Q56 168 100 168 Q144 168 144 196 V260 Z"
          fill={C.bgAlt}
          stroke={accent}
          strokeWidth={2.5}
          strokeLinejoin="round"
        />
        {/* Collar */}
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

        {/* Head */}
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
          {/* Hair */}
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
          <g
            stroke={C.ink}
            strokeWidth={2}
            strokeLinecap="round"
            opacity={0.75}
          >
            <path d={`M77 ${82 - brow * 2} Q84 ${78 - brow * 3} 91 ${82 - brow * 2}`} />
            <path d={`M109 ${82 - brow * 2} Q116 ${78 - brow * 3} 123 ${82 - brow * 2}`} />
          </g>

          {/* Mouth */}
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
    </svg>
  );
};
