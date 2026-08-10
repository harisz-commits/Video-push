import React from "react";
import { interpolate, useVideoConfig } from "remotion";
import type { Scene } from "../../lib/schema";
import type { SceneRenderProps } from "../shared/SceneShell";
import { Cue } from "../shared/Sound";
import { formatNumber } from "../shared/text";
import { C, T, TYPE } from "../shared/Tokens";
import { drive } from "../shared/motion";

type CounterScene = Extract<Scene, { type: "counter" }>;

/**
 * One to three large numbers counting up from zero.
 *
 * The count starts at frame 0 of the scene, and the scene starts on its
 * anchorPhrase — so the number begins ticking on the exact word that names it,
 * with no per-scene delay to tune.
 *
 * The landing is the point. A number that merely stops counting is a number
 * nobody registers, so each one overshoots and settles on the frame it arrives,
 * with a hit underneath it. A single value gets the full screen and the biggest
 * type in the film; two or three share it and step down accordingly.
 */
export const Counter: React.FC<SceneRenderProps<CounterScene>> = ({
  scene,
  frame,
  accent,
}) => {
  const { fps } = useVideoConfig();
  const values = scene.values;

  const falling =
    values.length === 2 && values[1].value < values[0].value;

  // One number owns the frame; three have to share it.
  const numberSize = values.length === 1 ? 260 : values.length === 2 ? 168 : 128;

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
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
          alignItems: "center",
          justifyContent: "center",
          gap: 72,
        }}
      >
        {values.map((entry, i) => (
          <React.Fragment key={`${entry.label}-${i}`}>
            {i > 0 ? (
              <Arrow
                falling={falling}
                progress={drive(frame, fps, 8 + i * T.stagger)}
              />
            ) : null}
            <Value
              label={entry.label}
              value={entry.value}
              suffix={entry.suffix}
              accent={accent}
              size={numberSize}
              frame={frame}
              landsAt={i * T.stagger + T.count}
              countProgress={drive(frame, fps, i * T.stagger, T.count)}
              enterProgress={drive(frame, fps, i * T.stagger)}
            />
          </React.Fragment>
        ))}
      </div>

      {/* One hit per number, on the frame it stops counting. */}
      {values.map((entry, i) => (
        <Cue
          key={`hit-${entry.label}-${i}`}
          name="impact"
          at={i * T.stagger + T.count}
          gain={values.length === 1 ? 1 : 0.8}
        />
      ))}

      {scene.sub ? (
        <div
          style={{
            ...TYPE.sub,
            marginTop: 64,
            textAlign: "center",
            maxWidth: 1200,
            opacity: drive(frame, fps, 16),
          }}
        >
          {scene.sub}
        </div>
      ) : null}
    </div>
  );
};

const Value: React.FC<{
  label: string;
  value: number;
  suffix?: string;
  accent: string;
  size: number;
  frame: number;
  landsAt: number;
  countProgress: number;
  enterProgress: number;
}> = ({
  label,
  value,
  suffix,
  accent,
  size,
  frame,
  landsAt,
  countProgress,
  enterProgress,
}) => {
  // A short punch outward on the landing frame, settling back over six frames.
  const punch = interpolate(
    frame,
    [landsAt - 1, landsAt + 2, landsAt + 8],
    [0, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        opacity: enterProgress,
        transform: `scale(${0.92 + 0.08 * enterProgress + 0.075 * punch})`,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 14 }}>
        <span
          style={{
            ...TYPE.number,
            fontSize: size,
            color: accent,
            textShadow: `0 0 ${40 * punch}px ${accent}`,
          }}
        >
          {formatNumber(value * countProgress, value)}
        </span>
        {suffix ? (
          <span
            style={{
              ...TYPE.number,
              fontSize: size * 0.4,
              color: accent,
              opacity: 0.75,
            }}
          >
            {suffix}
          </span>
        ) : null}
      </div>
      <div style={{ ...TYPE.label, marginTop: 12, textAlign: "center" }}>
        {label}
      </div>
    </div>
  );
};

/** Only drawn between two values; red and pointing down when the trend falls. */
const Arrow: React.FC<{ falling: boolean; progress: number }> = ({
  falling,
  progress,
}) => (
  <svg
    width={110}
    height={64}
    viewBox="0 0 110 64"
    fill="none"
    stroke={falling ? C.signal : C.muted}
    strokeWidth={4}
    strokeLinecap="round"
    strokeLinejoin="round"
    style={{ opacity: progress, transform: `scale(${0.92 + 0.08 * progress})` }}
  >
    <path d={falling ? "M8 20 H88" : "M8 32 H88"} />
    <path d={falling ? "M70 6 L90 20 L70 40" : "M70 18 L90 32 L70 46"} />
    {falling ? <path d="M90 20 L90 20" /> : null}
  </svg>
);
