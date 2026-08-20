"use client";

import React from "react";

/**
 * Make a Blob URL save the file instead of playing it.
 *
 * The `download` attribute alone is not enough here: it only applies to
 * same-origin links, and these videos are served from a Blob storage domain.
 * Vercel Blob answers `?download=1` with a Content-Disposition header, which
 * is the part the browser actually obeys.
 *
 * The distinction is not academic. A URL that came from the progress route
 * already carries the parameter; one that was rediscovered by looking the file
 * up in storage does not — so half the download links in the studio opened a
 * video player and the other half saved a file, depending on which path the
 * URL happened to take.
 */
export function toDownloadUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.searchParams.set("download", "1");
    return parsed.toString();
  } catch {
    return url;
  }
}

/**
 * The download button for a finished video.
 *
 * An anchor rather than a button, because saving a file is navigation and
 * should behave like it: middle-click, long-press, "save link as" all keep
 * working. Blue like every other control that hands you a file - see
 * --download in styles/global.css. It used to be the same green as a running
 * render, which put "läuft" and "fertig, hier ist es" in one colour.
 */
export const DownloadButton: React.FC<{
  url: string;
  sizeBytes?: number;
  label?: string;
}> = ({ url, sizeBytes, label = "Video herunterladen" }) => (
  <a
    href={toDownloadUrl(url)}
    download
    style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      marginTop: 10,
      padding: "13px 14px",
      border: "1px solid var(--download)",
      background: "var(--download)",
      color: "#fff",
      textAlign: "center",
      textDecoration: "none",
      fontSize: 13,
      fontWeight: 700,
      letterSpacing: "0.01em",
    }}
  >
    <span aria-hidden>↓</span>
    <span>
      {label}
      {sizeBytes ? ` · ${(sizeBytes / 1e6).toFixed(0)} MB` : ""}
    </span>
  </a>
);
