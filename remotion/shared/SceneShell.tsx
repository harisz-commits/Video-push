import React from "react";
import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { Caption } from "./Caption";
import { coveringRadius, type Portal } from "./portal";
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
const ENTER = 10;
const EXIT = 10;

/**
 * How far the camera pushes into the portal object.
 *
 * Large enough that the object is the only thing left in frame at the cut, but
 * no larger: past roughly two and a half the incoming scene spends its whole
 * reveal showing empty background between its own elements, and the shot only
 * becomes readable once the push is already over.
 */
const PUSH = 2.3;

/**
 * Where in the transition the fill takes over.
 *
 * The screen is solid colour only across the seam itself: the last fifth of
 * the outgoing scene and the first fifth of the incoming one, which at thirty
 * frames a second is about four frames of colour. Long enough to read as
 * passing through the object, short enough that forty-nine of them are not
 * forty-nine blackouts.
 */
const FILL_FROM = 0.62;

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
  /** The object this scene is left through. */
  exitPortal: Portal;
  /** The object the previous scene was left through, which this one opens out of. */
  enterPortal: Portal;
  children: React.ReactNode;
}> = ({
  from,
  durationInFrames,
  index,
  phase = "crisis",
  isPhaseTurn = false,
  vignette,
  exitPortal,
  enterPortal,
  children,
}) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
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

  // Transitions ride on top of the drift. The scene arrives already deep
  // inside the previous scene's portal and backs out of it; on the way out it
  // pushes into its own.
  const scale = drift * (1 + (PUSH - 1) * (1 - enter)) * (1 + (PUSH - 1) * exit);

  // The origin travels from the portal the scene opened out of to the one it
  // will close into. Interpolating it rather than switching means there is no
  // frame at which the whole picture jumps to a new anchor.
  const originX = interpolate(
    durationInFrames > 0 ? frame / durationInFrames : 0,
    [0, 1],
    [enterPortal.x, exitPortal.x],
  );
  const originY = interpolate(
    durationInFrames > 0 ? frame / durationInFrames : 0,
    [0, 1],
    [enterPortal.y, exitPortal.y],
  );

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
          transformOrigin: `${originX}% ${originY}%`,
        }}
      >
        {children}
      </AbsoluteFill>

      {/* The object itself, closing over the frame and opening out of it. */}
      <PortalFill
        portal={enterPortal}
        // 1 = covering the frame. The incoming scene starts covered.
        cover={interpolate(enter, [0, 1 - FILL_FROM], [1, 0], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        })}
        width={width}
        height={height}
      />
      <PortalFill
        portal={exitPortal}
        cover={interpolate(exit, [FILL_FROM, 1], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        })}
        width={width}
        height={height}
      />

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
 * The portal object, drawn as a disc that grows to swallow the frame.
 *
 * Nothing is drawn at all when it is not covering anything, so forty-nine of
 * these cost nothing for the ninety per cent of each scene that is not a
 * transition.
 */
const PortalFill: React.FC<{
  portal: Portal;
  cover: number;
  width: number;
  height: number;
}> = ({ portal, cover, width, height }) => {
  if (cover <= 0) return null;

  const radius = coveringRadius(portal, width, height) * cover;

  return (
    <AbsoluteFill style={{ overflow: "hidden", pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute",
          left: `${portal.x}%`,
          top: `${portal.y}%`,
          width: radius * 2,
          height: radius * 2,
          marginLeft: -radius,
          marginTop: -radius,
          borderRadius: "50%",
          backgroundColor: portal.color,
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
