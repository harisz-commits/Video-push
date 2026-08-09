import React from "react";
import { interpolate, useVideoConfig } from "remotion";
import type { Scene } from "../../lib/schema";
import { Icon } from "../shared/icons";
import type { SceneRenderProps } from "../shared/SceneShell";
import { formatNumber } from "../shared/text";
import { C, TYPE } from "../shared/Tokens";
import { drive } from "../shared/motion";

type IconGridScene = Extract<Scene, { type: "iconGrid" }>;

const PER_ROW = 8;
/** Frame at which icons start disappearing. */
const VANISH_AT = 20;
const VANISH_STAGGER = 2;
const VANISH_DURATION = 10;

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
  const columns = Math.min(PER_ROW, total);

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
          gridTemplateColumns: `repeat(${columns}, 1fr)`,
          gap: 34,
          maxWidth: 1280,
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
              <Icon name={scene.icon} size={96} />
            </div>
          );
        })}
      </div>
    </div>
  );
};
