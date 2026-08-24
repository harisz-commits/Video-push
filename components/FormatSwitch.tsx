"use client";

import React from "react";
import type { Format } from "../lib/constants";

/**
 * The switch between formats, at the top of everything.
 *
 * Vier Formate sind vier verschiedene Filme mit verschiedenen Regeln — einer
 * getaktet von einer Stimme, einer von einer Uhr, einer von einer Stimme über
 * Bildern, die er selbst gezeichnet hat, und einer über Grafiken, die aus
 * Zahlen entstehen. Das ist ein Moduswechsel, keine Einstellung. Es ist
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
        ["video", "Video"],
        ["finanz", "Finanz"],
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
            padding: "7px 15px",
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
