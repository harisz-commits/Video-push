import React from "react";
import { interpolate, useVideoConfig } from "remotion";
import type { Scene } from "../../lib/schema";
import { Icon } from "../shared/icons";
import type { SceneRenderProps } from "../shared/SceneShell";
import { formatNumber } from "../shared/text";
import { C, TYPE } from "../shared/Tokens";
import { drive } from "../shared/motion";
import { Cue } from "../shared/Sound";

type IconGridScene = Extract<Scene, { type: "iconGrid" }>;

/** Frame at which icons start disappearing. */
const VANISH_AT = 20;
const VANISH_STAGGER = 2;
const VANISH_DURATION = 10;

/**
 * A column count that leaves the last row as full as possible.
 *
 * A fixed eight columns turns twelve icons into a row of eight and a stump of
 * four, which reads as a rendering accident rather than a quantity. Twelve
 * wants six and six; twenty-four still wants eight.
 */
function columnsFor(total: number): number {
  if (total <= 10) return total;

  let best = 8;
  let bestScore = Infinity;
  for (let columns = 10; columns >= 5; columns--) {
    const remainder = total % columns;
    const empty = remainder === 0 ? 0 : columns - remainder;
    // Full rows dominate; among equally full options, prefer fewer rows.
    const score = empty * 10 + Math.ceil(total / columns);
    if (score < bestScore) {
      bestScore = score;
      best = columns;
    }
  }
  return best;
}

/** Icons shrink as rows stack, so even sixty-four of them stay in frame. */
function sizeForRows(rows: number): { icon: number; gap: number } {
  if (rows <= 2) return { icon: 96, gap: 34 };
  if (rows <= 4) return { icon: 76, gap: 26 };
  if (rows <= 6) return { icon: 58, gap: 20 };
  return { icon: 44, gap: 14 };
}

/** A grid of icons, of which some quietly disappear. "Farms are vanishing." */
export const IconGrid: React.FC<SceneRenderProps<IconGridScene>> = ({
  scene,
  frame,
  accent,
}) => {
  const { fps } = useVideoConfig();

  const total = Math.max(1, scene.total);
  const remaining = Math.min(total, Math.max(0, scene.remaining));
  const lost = total - remaining;

  const cells = Array.from({ length: total }, (_, i) => i);
  const columns = columnsFor(total);
  const { icon: iconSize, gap } = sizeForRows(Math.ceil(total / columns));

  // Icons vanish from the end backwards, so the survivors stay left-aligned.
  const vanishOrderOf = (index: number) => total - 1 - index;

  const displayedCount = cells.reduce((acc, i) => {
    const order = vanishOrderOf(i);
    if (order >= lost) return acc;
    const gone = interpolate(
      frame,
      [
        VANISH_AT + order * VANISH_STAGGER,
        VANISH_AT + order * VANISH_STAGGER + VANISH_DURATION,
      ],
      [0, 1],
      { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
    );
    return acc - gone;
  }, total);

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        position: "relative",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 0,
          right: 0,
          textAlign: "right",
        }}
      >
        <div style={{ ...TYPE.number, fontSize: 92, color: accent }}>
          {formatNumber(displayedCount, total)}
        </div>
        {scene.sub ? (
          <div style={{ ...TYPE.label, marginTop: 4 }}>{scene.sub}</div>
        ) : null}
      </div>

      {scene.headline ? (
        <div
          style={{
            ...TYPE.headline,
            fontSize: 56,
            marginBottom: 56,
            maxWidth: 1100,
            opacity: drive(frame, fps, 0),
          }}
        >
          {scene.headline}
        </div>
      ) : null}

      <div
        style={{
          display: "grid",
          // Fixed tracks rather than fractions: the grid then occupies only
          // what it needs, instead of stretching a short row across the frame.
          gridTemplateColumns: `repeat(${columns}, ${iconSize + 34}px)`,
          gap,
          justifyContent: "start",
        }}
      >
        {cells.map((i) => {
          const order = vanishOrderOf(i);
          const willVanish = order < lost;
          const appear = drive(frame, fps, i * 2);

          const gone = willVanish
            ? interpolate(
                frame,
                [
                  VANISH_AT + order * VANISH_STAGGER,
                  VANISH_AT + order * VANISH_STAGGER + VANISH_DURATION,
                ],
                [0, 1],
                { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
              )
            : 0;

          const opacity = appear * interpolate(gone, [0, 1], [1, 0.12]);
          const scale =
            (0.92 + 0.08 * appear) * interpolate(gone, [0, 1], [1, 0.9]);

          return (
            <div
              key={i}
              style={{
                display: "flex",
                justifyContent: "center",
                opacity,
                transform: `scale(${scale})`,
                color: gone > 0.5 ? C.muted : accent,
              }}
            >
              <Icon name={scene.icon} size={iconSize} />
            </div>
          );
        })}
      </div>

      {/*
        One tick per icon going out — but only for the first eight. Forty of
        them inside two seconds stops being a countdown and becomes a rattle.
      */}
      {Array.from({ length: Math.min(lost, 8) }, (_, k) => (
        <Cue key={`tick-${k}`} name="tick" at={VANISH_AT + k * VANISH_STAGGER} />
      ))}
    </div>
  );
};
