import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { Caption } from "./Caption";
import { useProject } from "./ProjectContext";
import { C, SAFE, T } from "./Tokens";

export type Phase = "crisis" | "solution";

/** Ground colour per phase — the one colour turn in the whole film. */
const GROUND: Record<Phase, string> = {
  crisis: C.bg,
  solution: "#0C2029", // navy shifted toward mint
};

export const ACCENT: Record<Phase, string> = {
  crisis: C.wheat,
  solution: C.mint,
};

/**
 * Background, grid, safe area and the caption layer.
 *
 * Scene cuts are hard by design — the only transition anywhere is the 8-frame
 * ground cross-fade on the first scene that flips from crisis to solution.
 */
export const SceneShell: React.FC<{
  /** Absolute frame at which this scene starts, for caption sync. */
  from: number;
  phase?: Phase;
  /** True only for the first scene of the solution phase. */
  isPhaseTurn?: boolean;
  /** Slight radial lift toward the centre — used by Hook and Closer. */
  vignette?: boolean;
  children: React.ReactNode;
}> = ({ from, phase = "crisis", isPhaseTurn = false, vignette, children }) => {
  const frame = useCurrentFrame();
  const { project } = useProject();

  const fadeIn = isPhaseTurn
    ? interpolate(frame, [0, T.phaseFade], [0, 1], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      })
    : 1;

  const ground = GROUND[phase];
  const previousGround = GROUND.crisis;

  return (
    <AbsoluteFill style={{ backgroundColor: previousGround }}>
      <AbsoluteFill style={{ backgroundColor: ground, opacity: fadeIn }} />

      {vignette ? (
        <AbsoluteFill
          style={{
            background:
              "radial-gradient(closest-side, rgba(255,255,255,0.05), rgba(255,255,255,0) 70%)",
          }}
        />
      ) : null}

      {/* Hairline grid at 8% — structure without decoration. */}
      <AbsoluteFill
        style={{
          opacity: 0.08,
          backgroundImage: `linear-gradient(to right, ${C.muted} 1px, transparent 1px), linear-gradient(to bottom, ${C.muted} 1px, transparent 1px)`,
          backgroundSize: "120px 120px",
        }}
      />

      <AbsoluteFill style={{ padding: SAFE }}>{children}</AbsoluteFill>

      {project.captions ? <Caption absoluteFrame={from + frame} /> : null}
    </AbsoluteFill>
  );
};

/** Props every scene component receives. */
export type SceneRenderProps<S> = {
  scene: S;
  /** Scene-relative frame. */
  frame: number;
  /** Wheat in the crisis half, mint in the solution half. */
  accent: string;
};
