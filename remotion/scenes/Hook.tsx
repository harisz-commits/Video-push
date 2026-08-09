import React from "react";
import { useVideoConfig } from "remotion";
import type { Scene } from "../../lib/schema";
import type { SceneRenderProps } from "../shared/SceneShell";
import { splitLines } from "../shared/text";
import { C, TYPE } from "../shared/Tokens";
import { drive } from "../shared/motion";

type HookScene = Extract<Scene, { type: "hook" }>;

/** Full-frame statement. Lines build one after another, 6 frames apart. */
export const Hook: React.FC<SceneRenderProps<HookScene>> = ({
  scene,
  frame,
  accent,
}) => {
  const { fps } = useVideoConfig();
  const lines = splitLines(scene.headline ?? scene.sub ?? "", 18);

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
      }}
    >
      {scene.kicker ? (
        <div
          style={{
            ...TYPE.label,
            color: accent,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            marginBottom: 28,
            ...styleOf(drive(frame, fps, 0)),
          }}
        >
          {scene.kicker}
        </div>
      ) : null}

      {lines.map((line, i) => (
        <div
          key={`${i}-${line}`}
          style={{
            ...TYPE.hook,
            ...styleOf(drive(frame, fps, 6 + i * 6)),
          }}
        >
          {line}
        </div>
      ))}

      {scene.sub && scene.headline ? (
        <div
          style={{
            ...TYPE.sub,
            marginTop: 36,
            maxWidth: 1100,
            color: C.muted,
            ...styleOf(drive(frame, fps, 6 + lines.length * 6)),
          }}
        >
          {scene.sub}
        </div>
      ) : null}
    </div>
  );
};

function styleOf(progress: number) {
  return {
    opacity: progress,
    transform: `scale(${0.92 + 0.08 * progress})`,
  };
}
