import React from "react";
import { interpolate, useVideoConfig } from "remotion";
import type { Scene } from "../../lib/schema";
import type { SceneRenderProps } from "../shared/SceneShell";
import { C, TYPE } from "../shared/Tokens";
import { drive } from "../shared/motion";

type ChartScene = Extract<Scene, { type: "chart" }>;

/** The line draws itself over this many frames. */
const DRAW_FRAMES = 40;

const VIEW = { w: 1500, h: 640 };
const PAD = { left: 110, right: 50, top: 30, bottom: 80 };

/**
 * Line and bar charts drawn by hand with SVG paths.
 *
 * Deliberately no charting library: every library brings its own type scale,
 * tick logic and default palette, and the result stops looking like the rest
 * of the film.
 */
export const DataChart: React.FC<SceneRenderProps<ChartScene>> = ({
  scene,
  frame,
  accent,
}) => {
  const { fps } = useVideoConfig();

  const series = scene.series;
  const max = Math.max(...series);
  const min = Math.min(0, Math.min(...series));
  const span = max - min || 1;

  const plotW = VIEW.w - PAD.left - PAD.right;
  const plotH = VIEW.h - PAD.top - PAD.bottom;

  const xOf = (i: number) =>
    PAD.left +
    (series.length === 1 ? plotW / 2 : (i / (series.length - 1)) * plotW);
  const yOf = (v: number) => PAD.top + plotH - ((v - min) / span) * plotH;

  // Highlight the final point when the series climbs sharply.
  const climbing = series[series.length - 1] > series[0] * 1.3;

  const draw = interpolate(frame, [0, DRAW_FRAMES], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const linePath = series
    .map((v, i) => `${i === 0 ? "M" : "L"}${xOf(i).toFixed(1)} ${yOf(v).toFixed(1)}`)
    .join(" ");

  const gridValues = [0, 0.25, 0.5, 0.75, 1];

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
            fontSize: 52,
            marginBottom: 24,
            opacity: drive(frame, fps, 0),
          }}
        >
          {scene.headline}
        </div>
      ) : null}

      {scene.sub ? (
        <div style={{ ...TYPE.sub, marginBottom: 20, opacity: drive(frame, fps, 4) }}>
          {scene.sub}
        </div>
      ) : null}

      <svg
        viewBox={`0 0 ${VIEW.w} ${VIEW.h}`}
        width="100%"
        style={{ overflow: "visible" }}
      >
        {/* Horizontal guides */}
        {gridValues.map((g) => {
          const y = PAD.top + plotH - g * plotH;
          return (
            <line
              key={g}
              x1={PAD.left}
              x2={VIEW.w - PAD.right}
              y1={y}
              y2={y}
              stroke={C.muted}
              strokeWidth={1}
              opacity={0.18}
            />
          );
        })}

        {/* Axes */}
        <line
          x1={PAD.left}
          y1={PAD.top}
          x2={PAD.left}
          y2={PAD.top + plotH}
          stroke={C.muted}
          strokeWidth={2}
          opacity={0.7}
        />
        <line
          x1={PAD.left}
          y1={PAD.top + plotH}
          x2={VIEW.w - PAD.right}
          y2={PAD.top + plotH}
          stroke={C.muted}
          strokeWidth={2}
          opacity={0.7}
        />

        {/* Y scale */}
        {gridValues.map((g) => {
          const value = min + g * span;
          const y = PAD.top + plotH - g * plotH;
          return (
            <text
              key={`y-${g}`}
              x={PAD.left - 18}
              y={y + 8}
              textAnchor="end"
              style={{ ...TYPE.axis, fontSize: 22 }}
              fill={C.muted}
            >
              {formatTick(value)}
              {scene.unit && g === 1 ? ` ${scene.unit}` : ""}
            </text>
          );
        })}

        {scene.variant === "bar" ? (
          series.map((v, i) => {
            const barW = Math.min(90, (plotW / series.length) * 0.55);
            const grow = drive(frame, fps, i * 4, 18);
            const fullH = PAD.top + plotH - yOf(v);
            const isLast = i === series.length - 1;
            return (
              <rect
                key={i}
                x={xOf(i) - barW / 2}
                y={PAD.top + plotH - fullH * grow}
                width={barW}
                height={fullH * grow}
                fill={isLast && climbing ? C.signal : accent}
                rx={2}
              />
            );
          })
        ) : (
          <>
            {/*
              pathLength="1" normalises the geometry, so a dash offset of
              1 -> 0 draws the line without ever measuring it in the DOM.
            */}
            <path
              d={linePath}
              fill="none"
              stroke={accent}
              strokeWidth={5}
              strokeLinecap="round"
              strokeLinejoin="round"
              pathLength={1}
              strokeDasharray={1}
              strokeDashoffset={1 - draw}
            />
            {series.map((v, i) => {
              const appearAt = series.length === 1 ? 0 : i / (series.length - 1);
              const shown = draw >= appearAt ? 1 : 0;
              const isLast = i === series.length - 1;
              return (
                <circle
                  key={i}
                  cx={xOf(i)}
                  cy={yOf(v)}
                  r={isLast ? 12 : 8}
                  fill={isLast && climbing ? C.signal : accent}
                  opacity={shown}
                />
              );
            })}
          </>
        )}

        {/* X scale */}
        {scene.labels.map((label, i) => {
          if (i >= series.length) return null;
          return (
            <text
              key={`x-${i}`}
              x={xOf(i)}
              y={PAD.top + plotH + 44}
              textAnchor="middle"
              style={{ ...TYPE.axis, fontSize: 22 }}
              fill={C.muted}
              opacity={drive(frame, fps, 6 + i * 2)}
            >
              {label}
            </text>
          );
        })}
      </svg>
    </div>
  );
};

function formatTick(value: number): string {
  const rounded = Math.abs(value) >= 100 ? Math.round(value) : value;
  return new Intl.NumberFormat("de-DE", {
    maximumFractionDigits: Math.abs(value) >= 100 ? 0 : 1,
  }).format(rounded);
}
