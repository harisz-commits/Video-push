import React from "react";
import { AbsoluteFill, interpolate } from "remotion";
import type { LevelSkin } from "./levels";

/**
 * The rotating ray background.
 *
 * It exists to make a standstill impossible. A quiz spends five seconds at a
 * time on one question, and for those five seconds the only things moving are
 * the timer bar and this — so it turns slowly and never stops, which is the
 * difference between "a still frame with a countdown" and "a video".
 *
 * Drawn as one SVG of wedges rather than a repeating-conic-gradient, because
 * the gradient version banded badly at 1080p and cost more to rasterise than
 * twenty polygons.
 */
export const Sunburst: React.FC<{
  frame: number;
  skin: LevelSkin;
  /** Degrees per second. Slow — this is wallpaper, not an event. */
  speed?: number;
  wedges?: number;
}> = ({ frame, skin, speed = 6, wedges = 18 }) => {
  const rotation = (frame / 30) * speed;

  // Long enough that a corner never shows the end of a ray while rotating.
  const R = 1600;
  const step = 360 / wedges;

  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <AbsoluteFill
        style={{
          background: `radial-gradient(circle at 50% 45%, ${skin.lift} 0%, ${skin.deep} 72%)`,
        }}
      />
      <AbsoluteFill
        style={{
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <svg
          width={2 * R}
          height={2 * R}
          viewBox={`${-R} ${-R} ${2 * R} ${2 * R}`}
          style={{
            transform: `rotate(${rotation}deg)`,
            // Every other wedge only; the gaps are the background showing
            // through, which keeps the contrast low enough to read text over.
            opacity: 0.5,
          }}
        >
          {Array.from({ length: Math.floor(wedges / 2) }, (_, i) => {
            const a0 = ((i * 2 * step - step / 2) * Math.PI) / 180;
            const a1 = ((i * 2 * step + step / 2) * Math.PI) / 180;
            return (
              <polygon
                key={i}
                points={`0,0 ${R * Math.cos(a0)},${R * Math.sin(a0)} ${R * Math.cos(a1)},${R * Math.sin(a1)}`}
                fill={skin.ray}
              />
            );
          })}
        </svg>
      </AbsoluteFill>

      {/*
        A slow breath on top of the rotation. Two motions at different speeds
        read as depth; one motion alone reads as a screensaver.
      */}
      <AbsoluteFill
        style={{
          background: `radial-gradient(circle at 50% 45%, rgba(255,255,255,${interpolate(
            Math.sin(frame / 34),
            [-1, 1],
            [0.03, 0.09],
          )}) 0%, rgba(0,0,0,0) 55%)`,
        }}
      />
      {/* Corners down, so the centre always wins the eye. */}
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(ellipse at 50% 50%, rgba(0,0,0,0) 45%, rgba(0,0,0,0.45) 100%)",
        }}
      />
    </AbsoluteFill>
  );
};
