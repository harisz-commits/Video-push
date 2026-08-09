"use client";

import React, { useState } from "react";
import type { ResolvedScene, Timing } from "../lib/align";
import type { Scene } from "../lib/schema";
import { formatTimecode } from "./ui";

/**
 * Scene cards plus the detail read-out.
 *
 * Cards are drag-reorderable. Reordering does NOT rewrite anchor phrases — it
 * just changes the order, and if that puts a scene ahead of the phrase it is
 * anchored to, the timing resolver flags the conflict instead of silently
 * re-cutting the film.
 */
export const SceneInspector: React.FC<{
  timing: Timing;
  selectedSceneId: string | null;
  selectedScene: ResolvedScene | null;
  fps: number;
  onSelect: (id: string) => void;
  onMove: (fromIndex: number, toIndex: number) => void;
  onUpdate: (id: string, patch: Partial<Scene>) => void;
}> = ({
  timing,
  selectedSceneId,
  selectedScene,
  fps,
  onSelect,
  onMove,
  onUpdate,
}) => {
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const warningFor = (id: string) =>
    timing.warnings.find((w) => w.sceneId === id);

  return (
    <div>
      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {timing.scenes.map((scene, i) => {
          const isSelected = scene.id === selectedSceneId;
          const warning = warningFor(scene.id);

          return (
            <li
              key={scene.id}
              draggable
              onDragStart={() => setDragIndex(i)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (dragIndex !== null && dragIndex !== i) onMove(dragIndex, i);
                setDragIndex(null);
              }}
              onDragEnd={() => setDragIndex(null)}
              onClick={() => onSelect(scene.id)}
              style={{
                border: "1px solid var(--grid)",
                borderLeft: warning
                  ? "3px solid var(--alert)"
                  : isSelected
                    ? "3px solid var(--wheat)"
                    : "3px solid transparent",
                background: isSelected ? "#fff" : "transparent",
                padding: "8px 10px",
                marginBottom: 6,
                cursor: "grab",
                opacity: dragIndex === i ? 0.4 : 1,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 8,
                }}
              >
                <span className="mono" style={{ fontSize: 11 }}>
                  {String(i + 1).padStart(2, "0")} {scene.type}
                </span>
                <span
                  className="mono"
                  style={{ fontSize: 11, color: "#5b6672" }}
                >
                  {formatTimecode(scene.startSeconds)} ·{" "}
                  {Math.round(scene.durationInFrames / fps)}s
                </span>
              </div>

              {scene.headline ? (
                <div
                  style={{
                    fontSize: 12,
                    marginTop: 3,
                    color: "#3a4552",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {scene.headline}
                </div>
              ) : null}

              {warning ? (
                <div
                  style={{
                    fontSize: 11,
                    marginTop: 4,
                    color: "var(--alert)",
                    lineHeight: 1.35,
                  }}
                >
                  ⚠ {warning.message}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      {selectedScene ? (
        <div
          style={{
            marginTop: 14,
            paddingTop: 12,
            borderTop: "1px solid var(--grid)",
          }}
        >
          <h3
            className="display"
            style={{ fontSize: 12, margin: "0 0 10px" }}
          >
            Detail
          </h3>

          <Row label="Typ" value={selectedScene.type} />
          <Row
            label="Start"
            value={`${formatTimecode(selectedScene.startSeconds)} · Frame ${selectedScene.from}`}
          />
          <Row
            label="Dauer"
            value={`${(selectedScene.durationInFrames / fps).toFixed(1)}s · ${selectedScene.durationInFrames} Frames`}
          />
          <Row label="Daten" value={summarize(selectedScene)} />
          <Row
            label="Anker"
            value={selectedScene.anchorResolved ? "gefunden" : "nicht gefunden"}
          />

          <label style={labelStyle}>anchorPhrase</label>
          <input
            value={selectedScene.anchorPhrase ?? ""}
            onChange={(e) =>
              onUpdate(selectedScene.id, {
                anchorPhrase: e.target.value,
              } as Partial<Scene>)
            }
            style={inputStyle}
          />

          <label style={labelStyle}>headline</label>
          <input
            value={selectedScene.headline ?? ""}
            onChange={(e) =>
              onUpdate(selectedScene.id, {
                headline: e.target.value,
              } as Partial<Scene>)
            }
            style={inputStyle}
          />

          <label style={labelStyle}>sub</label>
          <input
            value={selectedScene.sub ?? ""}
            onChange={(e) =>
              onUpdate(selectedScene.id, {
                sub: e.target.value,
              } as Partial<Scene>)
            }
            style={inputStyle}
          />
        </div>
      ) : null}
    </div>
  );
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 10.5,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "#5b6672",
  margin: "10px 0 3px",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "7px 9px",
  border: "1px solid var(--grid)",
  background: "#fff",
  fontSize: 12.5,
};

const Row: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div
    style={{
      display: "flex",
      justifyContent: "space-between",
      gap: 10,
      fontSize: 12,
      padding: "3px 0",
    }}
  >
    <span style={{ color: "#5b6672" }}>{label}</span>
    <span
      className="mono"
      style={{ fontSize: 11, textAlign: "right", maxWidth: "60%" }}
    >
      {value}
    </span>
  </div>
);

/** One-line read-out of whatever makes this scene type distinctive. */
function summarize(scene: ResolvedScene): string {
  switch (scene.type) {
    case "counter":
      return scene.values
        .map((v) => `${v.value}${v.suffix ? ` ${v.suffix}` : ""}`)
        .join(" → ");
    case "iconGrid":
      return `${scene.icon} ${scene.remaining}/${scene.total}`;
    case "chain":
      return `${scene.nodes.length} Glieder, Bruch ab ${scene.breakAt}`;
    case "split":
      return `${scene.left.icon} ↔ ${scene.right.icon}`;
    case "chart":
      return `${scene.variant}, ${scene.series.length} Werte`;
    case "pillars":
      return `${scene.pillars.length} Säulen, instabil ${scene.unstableIndex}`;
    case "mapFlow":
      return `${scene.region}, ${scene.flows.length} Ströme`;
    case "hook":
      return scene.kicker ?? "—";
    case "closer":
      return scene.statement.slice(0, 40);
    default:
      return "—";
  }
}
