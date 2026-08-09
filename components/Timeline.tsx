"use client";

import React, { useEffect, useRef, useState } from "react";
import type { Timing } from "../lib/align";
import { formatTimecode } from "./ui";

const BUCKETS = 640;

/**
 * The one place the app shows what it can do.
 *
 * A real waveform decoded from the ElevenLabs take, with the scene boundaries
 * drawn on top exactly where the anchor phrases fall. If a marker looks wrong
 * here, the timing is wrong — that is the point of showing them together.
 */
export const Timeline: React.FC<{
  audioUrl?: string;
  timing: Timing;
  fps: number;
  currentFrame: number;
  selectedSceneId: string | null;
  onSeek: (frame: number) => void;
  onSelectScene: (id: string) => void;
}> = ({
  audioUrl,
  timing,
  fps,
  currentFrame,
  selectedSceneId,
  onSeek,
  onSelectScene,
}) => {
  const peaks = useWaveform(audioUrl);
  const trackRef = useRef<HTMLDivElement>(null);

  const total = Math.max(1, timing.totalFrames);
  const durationSeconds = total / fps;

  const seekFromPointer = (clientX: number) => {
    const el = trackRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    onSeek(Math.round(ratio * total));
  };

  // A tick roughly every minute, but never more than ~10 labels.
  const tickStep = chooseTickStep(durationSeconds);
  const ticks: number[] = [];
  for (let t = 0; t <= durationSeconds; t += tickStep) ticks.push(t);

  return (
    <div
      style={{
        borderTop: "1px solid var(--grid)",
        background: "#fff",
        padding: "14px 20px 10px",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          marginBottom: 8,
        }}
      >
        <span className="display" style={{ fontSize: 12 }}>
          Wellenform &amp; Szenenmarker
        </span>
        <span className="mono" style={{ fontSize: 11, color: "#5b6672" }}>
          {timing.estimated
            ? "geschätzt — noch kein Audio"
            : `${timing.scenes.length} Szenen · ${formatTimecode(durationSeconds)}`}
        </span>
      </div>

      <div
        ref={trackRef}
        onPointerDown={(e) => seekFromPointer(e.clientX)}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") onSeek(Math.max(0, currentFrame - fps));
          if (e.key === "ArrowRight")
            onSeek(Math.min(total, currentFrame + fps));
        }}
        role="slider"
        tabIndex={0}
        aria-label="Zeitleiste"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={currentFrame}
        style={{
          position: "relative",
          height: 92,
          cursor: "pointer",
          background: "var(--field)",
          border: "1px solid var(--grid)",
          userSelect: "none",
        }}
      >
        <svg
          viewBox={`0 0 ${BUCKETS} 100`}
          preserveAspectRatio="none"
          width="100%"
          height="100%"
          style={{ display: "block" }}
        >
          {peaks
            ? peaks.map((p, i) => {
                const h = Math.max(1.5, p * 88);
                return (
                  <rect
                    key={i}
                    x={i}
                    y={50 - h / 2}
                    width={0.75}
                    height={h}
                    fill="var(--ink)"
                    opacity={0.42}
                  />
                );
              })
            : // No audio yet: a flat baseline rather than a fake waveform.
              [
                <line
                  key="baseline"
                  x1={0}
                  x2={BUCKETS}
                  y1={50}
                  y2={50}
                  stroke="var(--grid)"
                  strokeWidth={1}
                />,
              ]}
        </svg>

        {/* Scene boundaries, positioned from the resolved timings. */}
        {timing.scenes.map((scene, i) => {
          const left = (scene.from / total) * 100;
          const width = (scene.durationInFrames / total) * 100;
          const isSelected = scene.id === selectedSceneId;
          const unresolved = !scene.anchorResolved;

          return (
            <div
              key={scene.id}
              onPointerDown={(e) => {
                e.stopPropagation();
                onSelectScene(scene.id);
                onSeek(scene.from);
              }}
              title={`${scene.id} · ${scene.type} · ${formatTimecode(scene.startSeconds)}`}
              style={{
                position: "absolute",
                top: 0,
                bottom: 0,
                left: `${left}%`,
                width: `${width}%`,
                borderLeft: `1px solid ${unresolved ? "var(--alert)" : "var(--ink)"}`,
                background: isSelected
                  ? "rgba(200, 155, 60, 0.18)"
                  : "transparent",
                overflow: "hidden",
              }}
            >
              <span
                className="mono"
                style={{
                  position: "absolute",
                  top: 3,
                  left: 4,
                  fontSize: 9.5,
                  color: unresolved ? "var(--alert)" : "#5b6672",
                  whiteSpace: "nowrap",
                }}
              >
                {String(i + 1).padStart(2, "0")}
              </span>
            </div>
          );
        })}

        {/* Playhead */}
        <div
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: `${(currentFrame / total) * 100}%`,
            width: 2,
            background: "var(--wheat)",
            pointerEvents: "none",
          }}
        />
      </div>

      {/* Millimetre scale */}
      <div style={{ position: "relative", height: 18, marginTop: 4 }}>
        {ticks.map((t) => (
          <span
            key={t}
            className="mono"
            style={{
              position: "absolute",
              left: `${(t / durationSeconds) * 100}%`,
              transform: "translateX(-50%)",
              fontSize: 10.5,
              color: "#5b6672",
            }}
          >
            {formatTimecode(t)}
          </span>
        ))}
      </div>
    </div>
  );
};

function chooseTickStep(durationSeconds: number): number {
  for (const step of [30, 60, 120, 300]) {
    if (durationSeconds / step <= 10) return step;
  }
  return 600;
}

/**
 * Decode the MP3 once and reduce it to per-bucket peaks.
 *
 * Runs in the browser via Web Audio, so no server work and no extra dependency
 * — and it is the actual take being drawn, not a synthesised approximation.
 */
function useWaveform(audioUrl?: string): number[] | null {
  const [peaks, setPeaks] = useState<number[] | null>(null);

  useEffect(() => {
    if (!audioUrl) {
      setPeaks(null);
      return;
    }

    let cancelled = false;
    let ctx: AudioContext | null = null;

    (async () => {
      try {
        const response = await fetch(audioUrl);
        const bytes = await response.arrayBuffer();
        const Ctor =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext: typeof AudioContext })
            .webkitAudioContext;
        ctx = new Ctor();
        const buffer = await ctx.decodeAudioData(bytes);
        if (cancelled) return;

        const channel = buffer.getChannelData(0);
        const perBucket = Math.floor(channel.length / BUCKETS) || 1;
        const result: number[] = [];
        let max = 0.0001;

        for (let i = 0; i < BUCKETS; i++) {
          let peak = 0;
          const start = i * perBucket;
          for (let j = 0; j < perBucket; j += 8) {
            const v = Math.abs(channel[start + j] ?? 0);
            if (v > peak) peak = v;
          }
          result.push(peak);
          if (peak > max) max = peak;
        }

        setPeaks(result.map((p) => p / max));
      } catch {
        // A waveform is a nicety; failing to draw it must not break the studio.
        if (!cancelled) setPeaks(null);
      } finally {
        await ctx?.close().catch(() => {});
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [audioUrl]);

  return peaks;
}
