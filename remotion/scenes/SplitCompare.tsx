import React from "react";
import { interpolate, useVideoConfig } from "remotion";
import type { Panel, Scene } from "../../lib/schema";
import { ICON_NAMES } from "../../lib/schema";
import { Icon } from "../shared/icons";
import type { SceneRenderProps } from "../shared/SceneShell";
import { C, TYPE } from "../shared/Tokens";
import { drive } from "../shared/motion";

type SplitScene = Extract<Scene, { type: "split" }>;

/** The connector shuttles back and forth on this cycle. */
const LOOP_FRAMES = 60;

/** Two panels either side of a hairline. "The schnitzel grows in South America." */
export const SplitCompare: React.FC<SceneRenderProps<SplitScene>> = ({
  scene,
  frame,
  accent,
}) => {
  const { fps } = useVideoConfig();

  const connectorIcon = ICON_NAMES.includes(
    scene.connector as (typeof ICON_NAMES)[number],
  )
    ? (scene.connector as (typeof ICON_NAMES)[number])
    : null;

  // Ping-pong 0 -> 1 -> 0 so the connector never jumps at the loop seam.
  const cycle = (frame % LOOP_FRAMES) / LOOP_FRAMES;
  const shuttle = cycle < 0.5 ? cycle * 2 : (1 - cycle) * 2;

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
      }}
    >
      {scene.headline ? (
        <div
          style={{
            ...TYPE.headline,
            fontSize: 56,
            marginBottom: 64,
            textAlign: "center",
            opacity: drive(frame, fps, 0),
          }}
        >
          {scene.headline}
        </div>
      ) : null}

      <div
        style={{
          display: "flex",
          alignItems: "stretch",
          justifyContent: "center",
          position: "relative",
        }}
      >
        <Side panel={scene.left} accent={accent} progress={drive(frame, fps, 4)} />

        <div
          style={{
            width: 2,
            alignSelf: "stretch",
            backgroundColor: C.muted,
            opacity: 0.4 * drive(frame, fps, 2),
            margin: "0 48px",
          }}
        />

        <Side panel={scene.right} accent={accent} progress={drive(frame, fps, 8)} />

        {connectorIcon ? (
          <div
            style={{
              position: "absolute",
              top: "50%",
              left: `${interpolate(shuttle, [0, 1], [26, 74])}%`,
              transform: "translate(-50%, -50%)",
              color: accent,
              opacity: drive(frame, fps, 14),
            }}
          >
            <Icon name={connectorIcon} size={84} />
          </div>
        ) : null}
      </div>

      {scene.sub ? (
        <div
          style={{
            ...TYPE.sub,
            marginTop: 64,
            textAlign: "center",
            opacity: drive(frame, fps, 16),
          }}
        >
          {scene.sub}
        </div>
      ) : null}
    </div>
  );
};

const Side: React.FC<{ panel: Panel; accent: string; progress: number }> = ({
  panel,
  accent,
  progress,
}) => (
  <div
    style={{
      flex: "0 0 620px",
      backgroundColor: C.bgAlt,
      borderRadius: 2,
      padding: 56,
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      gap: 24,
      opacity: progress,
      transform: `scale(${0.92 + 0.08 * progress})`,
    }}
  >
    <div style={{ color: accent }}>
      <Icon name={panel.icon} size={132} />
    </div>
    <div
      style={{
        ...TYPE.headline,
        fontSize: 44,
        textAlign: "center",
        lineHeight: 1.15,
      }}
    >
      {panel.label}
    </div>
    {panel.caption ? (
      <div style={{ ...TYPE.sub, fontSize: 28, textAlign: "center" }}>
        {panel.caption}
      </div>
    ) : null}
  </div>
);
