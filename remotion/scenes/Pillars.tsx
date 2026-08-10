import React from "react";
import { interpolate, useVideoConfig } from "remotion";
import type { Scene } from "../../lib/schema";
import type { SceneRenderProps } from "../shared/SceneShell";
import { C, TYPE } from "../shared/Tokens";
import { drive } from "../shared/motion";
import { Cue } from "../shared/Sound";

type PillarsScene = Extract<Scene, { type: "pillars" }>;

/** Frame at which the unstable pillar starts to wobble. */
const WOBBLE_AT = 50;
const WOBBLE_DEGREES = 1.5;
const WOBBLE_PERIOD = 14;

/** Columns carrying a platform, one of which is not holding. */
export const Pillars: React.FC<SceneRenderProps<PillarsScene>> = ({
  scene,
  frame,
  accent,
}) => {
  const { fps } = useVideoConfig();

  // Announced by the sound a beat before the eye catches the movement.
  const wobbleAmount = interpolate(frame, [WOBBLE_AT, WOBBLE_AT + 20], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const wobble =
    Math.sin((frame / WOBBLE_PERIOD) * Math.PI * 2) *
    WOBBLE_DEGREES *
    wobbleAmount;

  const platformEnter = drive(frame, fps, 2);

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {scene.headline ? (
        <div
          style={{
            ...TYPE.headline,
            fontSize: 52,
            marginBottom: 56,
            textAlign: "center",
            opacity: drive(frame, fps, 0),
          }}
        >
          {scene.headline}
        </div>
      ) : null}

      {/* Platform — tilts minimally with the failing pillar. */}
      <div
        style={{
          width: 1100,
          height: 108,
          backgroundColor: C.bgAlt,
          border: `2px solid ${accent}`,
          borderRadius: 2,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          opacity: platformEnter,
          transform: `rotate(${wobble * 0.25}deg) scale(${0.92 + 0.08 * platformEnter})`,
          transformOrigin: "center",
        }}
      >
        <div
          style={{
            ...TYPE.headline,
            fontSize: 40,
            color: accent,
          }}
        >
          {scene.carries}
        </div>
      </div>

      <div
        style={{
          width: 1100,
          display: "flex",
          justifyContent: "space-around",
          alignItems: "flex-start",
        }}
      >
        {scene.pillars.map((label, i) => {
          const unstable = i === scene.unstableIndex;
          const appear = drive(frame, fps, 6 + i * 4);
          const color = unstable && wobbleAmount > 0 ? C.signal : C.muted;

          return (
            <div
              key={`${label}-${i}`}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                opacity: appear,
                transform: `rotate(${unstable ? wobble : 0}deg) scale(${0.92 + 0.08 * appear})`,
                transformOrigin: "bottom center",
              }}
            >
              <div
                style={{
                  width: 68,
                  height: 300,
                  backgroundColor: unstable
                    ? "rgba(196, 69, 47, 0.12)"
                    : C.bgAlt,
                  border: `2px solid ${color}`,
                  borderTop: "none",
                  borderRadius: 2,
                }}
              />
              <div
                style={{
                  ...TYPE.label,
                  marginTop: 20,
                  color: unstable && wobbleAmount > 0 ? C.signal : C.muted,
                  textAlign: "center",
                  maxWidth: 200,
                }}
              >
                {label}
              </div>
            </div>
          );
        })}
      </div>

      {/* The load shifting, heard just before it is seen. */}
      <Cue name="rumble" at={WOBBLE_AT - 4} />
    </div>
  );
};
