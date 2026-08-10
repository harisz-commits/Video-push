import React from "react";
import { interpolate, useVideoConfig } from "remotion";
import type { Scene } from "../../lib/schema";
import { Figure } from "../shared/character/Figure";
import { useProject } from "../shared/ProjectContext";
import type { SceneRenderProps } from "../shared/SceneShell";
import { splitLines } from "../shared/text";
import { C, TYPE } from "../shared/Tokens";
import { drive } from "../shared/motion";
import { isSpeaking, visemeAt } from "../shared/visemes";

type NarratorScene = Extract<Scene, { type: "narrator" }>;

type Pose = {
  armLeft: number;
  armRight: number;
  headTurn: number;
  shrug: number;
};

/**
 * The four things the narrator can do with its body.
 *
 * Rigged rather than animated, in the spirit of the reference: a small set of
 * readable actions the script picks from, not fluid motion. Each one settles
 * into place shortly after the scene opens and then holds, because a pose that
 * keeps moving competes with the mouth for attention.
 */
function poseFor(
  action: NonNullable<NarratorScene["action"]>,
  frame: number,
  settled: number,
  idle: number,
): Pose {
  switch (action) {
    case "point":
      // Toward the headline, which always sits to the figure's right.
      return {
        armLeft: idle * 0.4,
        armRight: idle + (1 - idle) * settled,
        headTurn: 4 * settled,
        shrug: 0,
      };
    case "shake":
      // Slow no. Two full swings, then back to centre.
      return {
        armLeft: idle,
        armRight: idle,
        headTurn: 7 * settled * Math.sin(frame / 7) * Math.exp(-frame / 90),
        shrug: 0,
      };
    case "shrug":
      return {
        armLeft: 0.35 + 0.25 * settled,
        armRight: 0.35 + 0.25 * settled,
        headTurn: 0,
        shrug: settled,
      };
    case "talk":
    default:
      return { armLeft: idle, armRight: idle * 1.15, headTurn: 0, shrug: 0 };
  }
}

/** Blink roughly every four seconds, over four frames. */
const BLINK_PERIOD = 120;
const BLINK_FRAMES = 4;

/**
 * The narrator says the line the voiceover is on.
 *
 * The mouth is not decoration timed by hand — it reads the same character
 * timestamps the scene cuts come from, so it stays in sync no matter how the
 * script changes. Everything else moves on its own schedule: blinking, a slow
 * sway, and arms that lift while there is actually speech to punctuate.
 */
export const Narrator: React.FC<
  SceneRenderProps<NarratorScene> & { absoluteFrame: number }
> = ({ scene, frame, absoluteFrame, accent }) => {
  const { fps } = useVideoConfig();
  const { project } = useProject();

  const seconds = absoluteFrame / fps;
  const viseme = visemeAt(project.alignment, seconds);
  const speaking = isSpeaking(project.alignment, seconds);

  const sinceBlink = absoluteFrame % BLINK_PERIOD;
  const blink =
    sinceBlink < BLINK_FRAMES
      ? Math.sin((sinceBlink / BLINK_FRAMES) * Math.PI)
      : 0;

  const sway = Math.sin(absoluteFrame / 48);

  // Arms drift while speaking and settle during pauses — the baseline the
  // named actions are layered on top of.
  const idle =
    interpolate(Math.sin(absoluteFrame / 70), [-1, 1], [0.05, 0.32]) *
    (speaking ? 1 : 0.4);

  const enter = drive(frame, fps, 0);
  const settled = drive(frame, fps, 6); // actions strike after the figure lands
  const pose = poseFor(scene.action ?? "talk", frame, settled, idle);
  const lines = splitLines(scene.headline ?? "", 16);

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 64,
      }}
    >
      <div
        style={{
          flex: "0 0 auto",
          opacity: enter,
          transform: `scale(${0.92 + 0.08 * enter})`,
          transformOrigin: "bottom center",
        }}
      >
        <Figure
          viseme={viseme}
          blink={blink}
          sway={sway}
          armLeft={pose.armLeft}
          armRight={pose.armRight}
          headTurn={pose.headTurn}
          shrug={pose.shrug}
          accent={accent}
        />
      </div>

      <div style={{ flex: 1, maxWidth: 1000 }}>
        {lines.map((line, i) => {
          const p = drive(frame, fps, 4 + i * 6);
          return (
            <div
              key={`${i}-${line}`}
              style={{
                ...TYPE.headline,
                fontSize: 72,
                opacity: p,
                transform: `translateX(${(1 - p) * 24}px)`,
              }}
            >
              {line}
            </div>
          );
        })}
        {scene.sub ? (
          <div
            style={{
              ...TYPE.sub,
              marginTop: 28,
              color: C.muted,
              opacity: drive(frame, fps, 10),
            }}
          >
            {scene.sub}
          </div>
        ) : null}
      </div>
    </div>
  );
};
