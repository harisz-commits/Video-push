import React from "react";
import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import type { Scene } from "../../lib/schema";
import type { SceneRenderProps } from "../shared/SceneShell";
import { splitLines } from "../shared/text";
import { TYPE } from "../shared/Tokens";
import { drive } from "../shared/motion";
import { Cue } from "../shared/Sound";

type CloserScene = Extract<Scene, { type: "closer" }>;

/**
 * Like Hook, but the camera pulls back across the whole scene and the last
 * 20 frames fade to navy.
 */
export const Closer: React.FC<
  SceneRenderProps<CloserScene> & { durationInFrames: number }
> = ({ scene, frame, accent, durationInFrames }) => {
  const { fps } = useVideoConfig();
  useCurrentFrame();

  const lines = splitLines(scene.statement, 22);

  const pullBack = interpolate(frame, [0, durationInFrames], [1, 0.88], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const fadeOut = interpolate(
    frame,
    [Math.max(0, durationInFrames - 20), durationInFrames],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        transform: `scale(${pullBack})`,
        opacity: fadeOut,
      }}
    >
      {scene.headline ? (
        <div
          style={{
            ...TYPE.label,
            color: accent,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            marginBottom: 28,
            opacity: drive(frame, fps, 0),
          }}
        >
          {scene.headline}
        </div>
      ) : null}

      {lines.map((line, i) => {
        const p = drive(frame, fps, 4 + i * 6);
        return (
          <div
            key={`${i}-${line}`}
            style={{
              ...TYPE.hook,
              fontSize: 96,
              opacity: p,
              transform: `scale(${0.92 + 0.08 * p})`,
            }}
          >
            {line}
          </div>
        );
      })}

      {/* The film's last word gets the film's lowest sound. */}
      <Cue name="rumble" at={2} />
    </div>
  );
};
