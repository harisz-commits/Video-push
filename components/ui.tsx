"use client";

import React from "react";

/** A numbered panel in the left rail. */
export const Panel: React.FC<{
  step: string;
  title: string;
  children: React.ReactNode;
  right?: React.ReactNode;
}> = ({ step, title, children, right }) => (
  <section
    style={{
      borderTop: "1px solid var(--grid)",
      padding: "18px 0",
    }}
  >
    <header
      style={{
        display: "flex",
        alignItems: "baseline",
        gap: 10,
        marginBottom: 12,
      }}
    >
      <span className="mono" style={{ fontSize: 12, opacity: 0.55 }}>
        {step}
      </span>
      <h2
        className="display"
        style={{ fontSize: 13, margin: 0, letterSpacing: "0.02em", flex: 1 }}
      >
        {title}
      </h2>
      {right}
    </header>
    {children}
  </section>
);

export const Button: React.FC<
  React.ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: "primary" | "ghost";
    title?: string;
  }
> = ({ variant = "primary", style, disabled, ...rest }) => (
  <button
    {...rest}
    disabled={disabled}
    style={{
      width: "100%",
      padding: "11px 14px",
      border: `1px solid ${variant === "primary" ? "var(--ink)" : "var(--grid)"}`,
      background:
        variant === "primary"
          ? disabled
            ? "var(--grid)"
            : "var(--ink)"
          : "transparent",
      color:
        variant === "primary"
          ? disabled
            ? "#7c8694"
            : "var(--field)"
          : "var(--ink)",
      cursor: disabled ? "not-allowed" : "pointer",
      fontSize: 13,
      fontWeight: 600,
      letterSpacing: "0.01em",
      transition: "background 120ms linear",
      ...style,
    }}
  />
);

export const Field: React.FC<
  React.InputHTMLAttributes<HTMLInputElement>
> = (props) => (
  <input
    {...props}
    style={{
      width: "100%",
      padding: "10px 12px",
      border: "1px solid var(--grid)",
      background: "#fff",
      fontSize: 14,
      ...props.style,
    }}
  />
);

/** Status line. Errors say what happened and what to do — never just "Fehler". */
export const Note: React.FC<{
  tone: "info" | "alert" | "live";
  children: React.ReactNode;
}> = ({ tone, children }) => (
  <p
    style={{
      margin: "10px 0 0",
      fontSize: 12.5,
      lineHeight: 1.45,
      color:
        tone === "alert"
          ? "var(--alert)"
          : tone === "live"
            ? "var(--live)"
            : "#5b6672",
      borderLeft: `2px solid ${
        tone === "alert"
          ? "var(--alert)"
          : tone === "live"
            ? "var(--live)"
            : "var(--grid)"
      }`,
      paddingLeft: 10,
    }}
  >
    {children}
  </p>
);

export function formatTimecode(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
