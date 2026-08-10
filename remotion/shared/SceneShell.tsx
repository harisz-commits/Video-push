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

/** Frames a scene spends arriving and leaving. */
const ENTER = 9;
const EXIT = 7;

/**
 * Background, grid, motion, transitions and the caption layer.
 *
 * Two rules from the brief are enforced here rather than in each scene, because
 * forty-nine scenes will not obey them one at a time:
 *
 * "Kein Stillstand" — nothing is ever fully still. A scene drifts across its
 * whole length, alternating direction so consecutive shots do not all push the
 * same way, and two soft shapes move through the background behind everything.
 *
 * "Nahtlose Übergänge" — cuts are not hard. A scene opens out of a scale that
 * is slightly too large and closes by pulling away, with a bar wiping through
 * the seam, so one shot appears to open out of the last rather than replace it.
 */
export const SceneShell: React.FC<{
  /** Absolute frame at which this scene starts, for caption sync. */
  from: number;
  /** How long this scene runs, for the exit. */
  durationInFrames: number;
  /** Position in the film — only its parity is used, to alternate the drift. */
  index: number;
  phase?: Phase;
  /** True only for the first scene of the solution phase. */
  isPhaseTurn?: boolean;
  /** Slight radial lift toward the centre — used by Hook and Closer. */
  vignette?: boolean;
  children: React.ReactNode;
}> = ({
  from,
  durationInFrames,
  index,
  phase = "crisis",
  isPhaseTurn = false,
  vignette,
  children,
}) => {
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

  // Arrival and departure, as one number each.
  const enter = interpolate(frame, [0, ENTER], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const exit = interpolate(
    frame,
    [durationInFrames - EXIT, durationInFrames],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  // The long push across the shot. Direction alternates so the film does not
  // creep steadily in one direction over five minutes.
  const towards = index % 2 === 0 ? 1 : -1;
  const progress = durationInFrames > 0 ? frame / durationInFrames : 0;
  const drift = 1 + towards * 0.045 * progress;

  // Transitions ride on top of the drift: too big on the way in, pulling away
  // on the way out.
  const scale = drift * (1 + 0.07 * (1 - enter)) * (1 - 0.035 * exit);
  const opacity = enter * (1 - exit);

  return (
    <AbsoluteFill style={{ backgroundColor: previousGround }}>
      <AbsoluteFill style={{ backgroundColor: ground, opacity: fadeIn }} />

      <BackgroundDrift absoluteFrame={from + frame} phase={phase} />

      {vignette ? (
        <AbsoluteFill
          style={{
            background:
              "radial-gradient(closest-side, rgba(255,255,255,0.05), rgba(255,255,255,0) 70%)",
          }}
        />
      ) : null}

      {/* Hairline grid at 8%, drifting against the content for parallax. */}
      <AbsoluteFill
        style={{
          opacity: 0.08,
          backgroundImage: `linear-gradient(to right, ${C.muted} 1px, transparent 1px), linear-gradient(to bottom, ${C.muted} 1px, transparent 1px)`,
          backgroundSize: "120px 120px",
          backgroundPosition: `${-towards * 0.05 * frame}px ${
            -0.03 * frame
          }px`,
        }}
      />

      <AbsoluteFill
        style={{
          padding: SAFE,
          transform: `scale(${scale}) translateY(${-3 * Math.sin(frame / 190)}px)`,
          transformOrigin: "center",
          opacity,
        }}
      >
        {children}
      </AbsoluteFill>

      <Wipe frame={frame} accent={ACCENT[phase]} direction={towards} />

      {project.captions ? (
        <Caption absoluteFrame={from + frame} accent={ACCENT[phase]} />
      ) : null}
    </AbsoluteFill>
  );
};

/**
 * Two very soft shapes crossing the frame.
 *
 * They are the "clouds go by" of the brief: at four per cent opacity nobody
 * looks at them, but a shot with them in it never reads as a still image, which
 * is the entire point. Driven by the absolute frame so they cross scene cuts
 * without restarting.
 */
const BackgroundDrift: React.FC<{ absoluteFrame: number; phase: Phase }> = ({
  absoluteFrame,
  phase,
}) => {
  const tint = phase === "crisis" ? C.wheat : C.mint;
  const blobs = [
    { size: 1500, speed: 0.55, y: 180, offset: 0, opacity: 0.05 },
    { size: 1100, speed: -0.38, y: 700, offset: 1400, opacity: 0.035 },
  ];

  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      {blobs.map((blob, i) => {
        // Wrap by hand so the loop is seamless at any length.
        const span = 1920 + blob.size;
        const raw = blob.offset + absoluteFrame * blob.speed;
        const x = ((raw % span) + span) % span - blob.size;

        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: x,
              top: blob.y - blob.size / 2,
              width: blob.size,
              height: blob.size,
              borderRadius: "50%",
              background: `radial-gradient(closest-side, ${tint}, transparent)`,
              opacity: blob.opacity,
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
};

/**
 * A bar sweeping through the cut.
 *
 * The seam between two scenes is the one moment the eye is guaranteed to be
 * looking for a change, so it gets something deliberate rather than a jump.
 */
const Wipe: React.FC<{ frame: number; accent: string; direction: number }> = ({
  frame,
  accent,
  direction,
}) => {
  const WIPE = 8;
  if (frame > WIPE) return null;

  const p = interpolate(frame, [0, WIPE], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  // A narrow band with a bright edge, not a broad gradient — a wide soft sweep
  // reads as a smear across the frame rather than as an edge passing through it.
  const x = interpolate(p, [0, 1], [direction > 0 ? -20 : 120, direction > 0 ? 120 : -20]);

  return (
    <AbsoluteFill style={{ overflow: "hidden", pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          left: `${x}%`,
          width: "16%",
          background: `linear-gradient(${
            direction > 0 ? "90deg" : "270deg"
          }, transparent, ${accent}18 55%, ${accent}99 88%, ${accent})`,
          opacity: 0.85 * (1 - p ** 2),
        }}
      />
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
