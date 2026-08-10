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

export const Figure: React.FC<{
  viseme: Viseme;
  /** 0 = eyes open, 1 = fully shut. */
  blink: number;
  /** Radians of gentle sway, driven by the caller so it stays frame-exact. */
  sway: number;
  /** 0 = arms down, 1 = gesturing. */
  gesture: number;
  accent: string;
  size?: number;
}> = ({ viseme, blink, sway, gesture, accent, size = 520 }) => {
  const mouth = MOUTHS[viseme];
  const eyeHeight = 1 - blink;

  return (
    <svg
      width={size}
      height={size * 1.3}
      viewBox="0 0 200 260"
      fill="none"
      style={{ overflow: "visible" }}
    >
      <g transform={`rotate(${sway * 1.6} 100 210)`}>
        {/* Torso */}
        <path
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

        {/* Arms — they lift a little when the narrator is making a point. */}
        <g
          transform={`rotate(${-14 * gesture} 60 200)`}
          stroke={accent}
          strokeWidth={2.5}
          strokeLinecap="round"
          fill="none"
        >
          <path d="M58 198 Q40 218 44 240" />
        </g>
        <g
          transform={`rotate(${14 * gesture} 142 200)`}
          stroke={accent}
          strokeWidth={2.5}
          strokeLinecap="round"
          fill="none"
        >
          <path d="M142 198 Q160 218 156 240" />
        </g>

        {/* Head */}
        <g transform={`rotate(${sway * 2.6} 100 120)`}>
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
            <path d={`M77 ${82 - gesture * 2} Q84 ${78 - gesture * 3} 91 ${82 - gesture * 2}`} />
            <path d={`M109 ${82 - gesture * 2} Q116 ${78 - gesture * 3} 123 ${82 - gesture * 2}`} />
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
