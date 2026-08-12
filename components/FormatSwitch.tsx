"use client";

import React from "react";
import type { Format } from "../lib/constants";

/**
 * The switch between formats, at the top of everything.
 *
 * Two formats are two different films with two different rules — one timed by
 * a voice, one by a clock — so this is a mode change, not a setting. It is
 * drawn as a segmented control rather than a dropdown because a mode you are
 * currently in should be visible without opening anything.
 */
export const FormatSwitch: React.FC<{
  value: Format;
  onChange: (format: Format) => void;
  disabled?: boolean;
}> = ({ value, onChange, disabled }) => (
  <div
    role="tablist"
    aria-label="Videoformat"
    style={{
      display: "inline-flex",
      border: "1px solid var(--grid)",
      borderRadius: 999,
      padding: 3,
      gap: 3,
      background: "rgba(0,0,0,0.03)",
    }}
  >
    {(
      [
        ["infographics", "Infographics"],
        ["quiz", "Quiz"],
      ] as const
    ).map(([key, label]) => {
      const active = value === key;
      return (
        <button
          key={key}
          role="tab"
          aria-selected={active}
          disabled={disabled}
          onClick={() => onChange(key)}
          style={{
            border: "none",
            borderRadius: 999,
            padding: "7px 18px",
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: "0.04em",
            cursor: disabled ? "not-allowed" : "pointer",
            background: active ? "var(--ink)" : "transparent",
            color: active ? "var(--field)" : "var(--ink)",
            opacity: disabled && !active ? 0.4 : 1,
            transition: "background 120ms linear",
          }}
        >
          {label}
        </button>
      );
    })}
  </div>
);
