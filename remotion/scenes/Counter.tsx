import React from "react";
import { useVideoConfig } from "remotion";
import type { Scene } from "../../lib/schema";
import type { SceneRenderProps } from "../shared/SceneShell";
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
              countProgress={drive(frame, fps, i * T.stagger, T.count)}
              enterProgress={drive(frame, fps, i * T.stagger)}
            />
          </React.Fragment>
        ))}
      </div>

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
  countProgress: number;
  enterProgress: number;
}> = ({ label, value, suffix, accent, countProgress, enterProgress }) => (
  <div
    style={{
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      opacity: enterProgress,
      transform: `scale(${0.92 + 0.08 * enterProgress})`,
    }}
  >
    <div style={{ display: "flex", alignItems: "baseline", gap: 14 }}>
      <span style={{ ...TYPE.number, color: accent }}>
        {formatNumber(value * countProgress, value)}
      </span>
      {suffix ? (
        <span
          style={{
            ...TYPE.number,
            fontSize: 64,
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
