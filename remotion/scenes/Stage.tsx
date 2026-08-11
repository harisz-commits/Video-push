import React from "react";
import { useVideoConfig } from "remotion";
import type { Scene } from "../../lib/schema";
import { Figure } from "../shared/character/Figure";
import { poseFor } from "../shared/character/poses";
import { drive } from "../shared/motion";
import type { SceneRenderProps } from "../shared/SceneShell";
import { Cue } from "../shared/Sound";
import { C, TYPE } from "../shared/Tokens";

type StageScene = Extract<Scene, { type: "stage" }>;

/** Where the ground sits, as a share of the content box. */
const HORIZON = 0.80;

/**
 * People doing something.
 *
 * The other scene types draw quantities; this one draws behaviour — a crowd
 * standing while one person runs, somebody pointing at what the line above
 * them says, a figure going down. It is the shot the reference uses whenever
 * the script stops describing a system and starts describing what the system
 * does to somebody.
 *
 * The cast is laid out along a ground line with the focus figure nearest the
 * camera and in the accent colour, everyone else smaller, muted and further
 * back. That hierarchy does the work a caption would otherwise have to: the
 * eye finds the one who matters without being told.
 */
export const Stage: React.FC<SceneRenderProps<StageScene>> = ({
  scene,
  frame,
  accent,
}) => {
  const { fps } = useVideoConfig();
  const cast = scene.cast;
  const focus = Math.min(scene.focusIndex ?? 0, cast.length - 1);

  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      {scene.headline ? (
        <div
          style={{
            ...TYPE.headline,
            fontSize: 60,
            maxWidth: 1200,
            opacity: drive(frame, fps, 0),
          }}
        >
          {scene.headline}
        </div>
      ) : null}

      {scene.sub ? (
        <div
          style={{
            ...TYPE.sub,
            marginTop: 20,
            color: C.muted,
            maxWidth: 900,
            opacity: drive(frame, fps, 8),
          }}
        >
          {scene.sub}
        </div>
      ) : null}

      {/* The ground. Without it the figures float and the shot has no floor. */}
      <div
        style={{
          position: "absolute",
          left: -40,
          right: -40,
          top: `${HORIZON * 100}%`,
          height: 2,
          background: `linear-gradient(90deg, transparent, ${C.muted}66 15%, ${C.muted}66 85%, transparent)`,
          opacity: drive(frame, fps, 4),
        }}
      />

      {cast.map((member, i) => {
        const isFocus = i === focus;

        // Spread the cast across the middle of the frame, focus front and
        // centre-left, the rest fanned out behind.
        const slot = cast.length === 1 ? 0.5 : 0.18 + (0.64 * i) / (cast.length - 1);
        const depth = isFocus ? 1 : 0.68 + ((i * 7) % 3) * 0.07;
        // Big enough to carry a 1920-wide frame: a small figure in a large
        // empty shot reads as a placeholder rather than a person.
        const height = 430 * depth;

        // Each figure gets its own offset into its cycle, so a crowd never
        // marches in step.
        const offset = i * 11;
        const pose = poseFor(
          member.action,
          frame + offset,
          drive(frame, fps, 4 + i * 3),
          0.12 + 0.1 * ((i % 3) / 2),
        );

        // Walking and running actually cross the frame, and wrap when they
        // leave it — that is what "panisch herumlaufen" has to look like.
        const travels = member.action === "walk" || member.action === "run";
        const x = travels
          ? (((slot * 100 + pose.travel) % 118) + 118) % 118 - 9
          : slot * 100;

        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: `${x}%`,
              top: `${HORIZON * 100}%`,
              transform: "translate(-50%, -100%)",
              opacity: drive(frame, fps, 4 + i * 3) * (isFocus ? 1 : 0.55),
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
            }}
          >
            <Figure
              {...pose}
              crop="full"
              height={height}
              accent={isFocus ? accent : C.muted}
            />
            {member.label ? (
              <div
                style={{
                  ...TYPE.label,
                  marginTop: 10,
                  color: isFocus ? accent : C.muted,
                  textAlign: "center",
                  maxWidth: 240,
                  whiteSpace: "nowrap",
                }}
              >
                {member.label}
              </div>
            ) : null}
          </div>
        );
      })}

      {/* A body hitting the floor is the one action here that has a sound. */}
      {cast.some((m) => m.action === "fall") ? (
        <Cue name="impact" at={14} gain={0.7} />
      ) : null}
    </div>
  );
};
