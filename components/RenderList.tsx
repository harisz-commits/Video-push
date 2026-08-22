"use client";

import React from "react";
import { toDownloadUrl } from "./DownloadButton";
import { Note } from "./ui";

export type ProjectRenderRow = {
  /** Set when this render is a vertical cut rather than the film. */
  shortId?: string;
  renderId: string;
  outputUrl?: string;
  sizeBytes?: number;
  at: number;
};

/**
 * The videos a project has produced.
 *
 * This exists because of a specific failure: a render was watched to 37%, the
 * phone was put down, and afterwards there was no way to find out whether it
 * had finished. It had — the file was in storage the whole time — but the only
 * thing that ever knew was a browser tab that had gone away.
 *
 * So the list is not fed by whoever happened to be watching. Every render is
 * filed against the project when it starts, and whether it finished is
 * answered by looking for the file, on the server, whenever the project is
 * opened. Walking away is now a supported way to use this.
 */
export const RenderList: React.FC<{
  renders: ProjectRenderRow[];
  /** The render happening right now, so it is not listed twice. */
  activeRenderId?: string;
}> = ({ renders, activeRenderId }) => {
  const rows = renders.filter((r) => r.renderId !== activeRenderId);
  if (rows.length === 0) return null;

  return (
    <div style={{ marginTop: 12 }}>
      <div
        className="mono"
        style={{ fontSize: 11, color: "#5b6672", marginBottom: 6 }}
      >
        Renders dieses Projekts
      </div>
      <div style={{ display: "grid", gap: 4 }}>
        {rows.map((r) => (
          <div
            key={r.renderId}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
              padding: "8px 10px",
              border: "1px solid var(--grid)",
              fontSize: 12,
            }}
          >
            <span className="mono" style={{ color: "#5b6672" }}>
              {new Date(r.at).toLocaleString("de-DE", {
                day: "2-digit",
                month: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
            {r.outputUrl ? (
              <a
                href={toDownloadUrl(r.outputUrl)}
                download
                style={{
                  fontWeight: 600,
                  color: "var(--download)",
                  textDecoration: "none",
                  whiteSpace: "nowrap",
                }}
              >
                ↓ Herunterladen
                {r.sizeBytes
                  ? ` · ${(r.sizeBytes / 1e6).toFixed(0)} MB`
                  : ""}
              </a>
            ) : (
              // Deliberately not "failed". A render with no file yet is either
              // still going or dead, and from here those look identical — so
              // say what is known instead of guessing which one it is.
              <span style={{ color: "#5b6672" }}>noch kein Video</span>
            )}
          </div>
        ))}
      </div>
      {rows.some((r) => !r.outputUrl) ? (
        <Note tone="info">
          Ein Render ohne Video läuft entweder noch oder ist abgebrochen. Lade
          das Projekt später neu — sobald die Datei da ist, erscheint sie hier
          von selbst.
        </Note>
      ) : null}
    </div>
  );
};
