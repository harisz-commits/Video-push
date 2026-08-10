import React from "react";
import { interpolate, useVideoConfig } from "remotion";
import type { Scene } from "../../lib/schema";
import { Icon } from "../shared/icons";
import type { SceneRenderProps } from "../shared/SceneShell";
import { C, TYPE } from "../shared/Tokens";
import { drive } from "../shared/motion";
import { Cue } from "../shared/Sound";

type ChainScene = Extract<Scene, { type: "chain" }>;

/** Frame at which the chain starts to fail. */
const BREAK_AT = 40;
const DOMINO_STAGGER = 5;
const TILT_DEGREES = 8;

/**
 * A causal chain that collapses. "No gas -> no fertiliser -> no harvest."
 * From `breakAt` onwards nodes turn red and topple like dominoes.
 */
export const Chain: React.FC<SceneRenderProps<ChainScene>> = ({
  scene,
  frame,
  accent,
}) => {
  const { fps } = useVideoConfig();
  const nodes = scene.nodes;

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
            marginBottom: 72,
            opacity: drive(frame, fps, 0),
          }}
        >
          {scene.headline}
        </div>
      ) : null}

      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "center",
          gap: 8,
        }}
      >
        {nodes.map((node, i) => {
          const broken = i >= scene.breakAt;
          const dominoIndex = i - scene.breakAt;

          const collapse = broken
            ? interpolate(
                frame,
                [
                  BREAK_AT + dominoIndex * DOMINO_STAGGER,
                  BREAK_AT + dominoIndex * DOMINO_STAGGER + 12,
                ],
                [0, 1],
                { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
              )
            : 0;

          const appear = drive(frame, fps, i * 4);
          const color = collapse > 0 ? blend(accent, C.signal, collapse) : accent;

          return (
            <React.Fragment key={`${node.label}-${i}`}>
              {i > 0 ? (
                <Connector
                  progress={drive(frame, fps, i * 4 - 2)}
                  broken={collapse}
                />
              ) : null}
              <div
                style={{
                  width: 210,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 20,
                  opacity: appear,
                  transform: `rotate(${collapse * TILT_DEGREES}deg) scale(${0.92 + 0.08 * appear})`,
                  transformOrigin: "bottom center",
                }}
              >
                <div
                  style={{
                    width: 148,
                    height: 148,
                    borderRadius: "50%",
                    border: `2px solid ${color}`,
                    backgroundColor: C.bgAlt,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color,
                  }}
                >
                  <Icon name={node.icon} size={78} />
                </div>
                <div
                  style={{
                    ...TYPE.label,
                    color: collapse > 0.5 ? C.signal : C.ink,
                    textAlign: "center",
                    lineHeight: 1.25,
                  }}
                >
                  {node.label}
                </div>
              </div>
            </React.Fragment>
          );
        })}
      </div>

      {/* The chain giving way: the failure itself, then the weight of it. */}
      <Cue name="glitch" at={BREAK_AT} />
      <Cue name="rumble" at={BREAK_AT + 4} gain={0.8} />
    </div>
  );
};

const Connector: React.FC<{ progress: number; broken: number }> = ({
  progress,
  broken,
}) => (
  <svg
    width={72}
    height={148}
    viewBox="0 0 72 148"
    fill="none"
    stroke={broken > 0.5 ? C.signal : C.muted}
    strokeWidth={3}
    strokeLinecap="round"
    strokeLinejoin="round"
    style={{ opacity: progress * (1 - broken * 0.6) }}
  >
    <path d="M8 74 H50" />
    <path d="M42 62 L58 74 L42 86" />
  </svg>
);

/** Mix two hex colours — used for the accent -> signal turn on collapse. */
function blend(a: string, b: string, t: number): string {
  const pa = hexToRgb(a);
  const pb = hexToRgb(b);
  const mix = pa.map((v, i) => Math.round(v + (pb[i] - v) * t));
  return `rgb(${mix[0]}, ${mix[1]}, ${mix[2]})`;
}

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  return [
    parseInt(clean.slice(0, 2), 16),
    parseInt(clean.slice(2, 4), 16),
    parseInt(clean.slice(4, 6), 16),
  ];
}
