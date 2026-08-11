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
import { poseFor } from "../shared/character/poses";

type NarratorScene = Extract<Scene, { type: "narrator" }>;

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
          {...pose}
          viseme={viseme}
          blink={blink}
          sway={sway}
          crop="bust"
          height={520}
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
