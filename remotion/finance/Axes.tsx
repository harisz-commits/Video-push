import React from "react";
import { C, FONT } from "../shared/Tokens";
import { withUnit } from "./format";

/**
 * Gitter, Achsen und Beschriftung — einmal, für alle Diagramme.
 *
 * Die waagerechten Linien liegen HINTER den Balken und der Kurve, nicht
 * darüber, und sie sind kaum sichtbar. Ein kräftiges Gitter ist der schnellste
 * Weg, ein Diagramm nach Tabellenkalkulation aussehen zu lassen; ein
 * angedeutetes ist der Unterschied zwischen „ungefähr da oben" und „achtzehn
 * Prozent".
 */

export const AXIS_LEFT = 152;

export const Grid: React.FC<{
  x: number;
  y: number;
  width: number;
  height: number;
  ticks: number[];
  max: number;
  /** Wie ein Strichwert beschriftet wird. Kommt aus axis(). */
  label: (value: number) => string;
  unit?: string;
  /** 0..1 — das Gitter zeichnet sich mit, statt fertig dazustehen. */
  progress: number;
}> = ({ x, y, width, height, ticks, max, label, unit, progress }) => (
  <>
    {ticks.map((value, i) => {
      const top = y + height - (value / max) * height;
      return (
        <React.Fragment key={value}>
          <div
            style={{
              position: "absolute",
              left: x + AXIS_LEFT,
              top,
              width: (width - AXIS_LEFT) * progress,
              height: 1,
              background: i === 0 ? C.muted : C.muted,
              opacity: i === 0 ? 0.55 : 0.16,
            }}
          />
          <div
            style={{
              position: "absolute",
              left: x,
              top: top - 15,
              width: AXIS_LEFT - 24,
              whiteSpace: "nowrap",
              textAlign: "right",
              fontFamily: FONT.mono,
              fontWeight: 700,
              fontSize: 22,
              fontVariantNumeric: "tabular-nums",
              color: C.muted,
              opacity: 0.75 * progress,
            }}
          >
            {i === 0 ? withUnit(0, unit) : label(value)}
          </div>
        </React.Fragment>
      );
    })}
  </>
);

/** Eine Beschriftung unter der Achse, mittig unter ihrem Element. */
export const AxisLabel: React.FC<{
  left: number;
  top: number;
  width: number;
  children: React.ReactNode;
  opacity?: number;
  strong?: boolean;
}> = ({ left, top, width, children, opacity = 1, strong }) => (
  <div
    style={{
      position: "absolute",
      left,
      top,
      width,
      textAlign: "center",
      fontFamily: FONT.body,
      fontWeight: strong ? 700 : 500,
      fontSize: 24,
      lineHeight: 1.2,
      color: strong ? C.ink : C.muted,
      opacity,
    }}
  >
    {children}
  </div>
);
