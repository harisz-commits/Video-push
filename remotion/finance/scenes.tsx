import React from "react";
import { useVideoConfig } from "remotion";
import {
  compoundSeries,
  resolveAufteilung,
  type FinanceScene,
} from "../../lib/finance";
import { drive, enter, stagger } from "../shared/motion";
import { C, FONT, TYPE } from "../shared/Tokens";
import { AxisLabel, AXIS_LEFT, Grid } from "./Axes";
import { axis, de, short, withUnit } from "./format";
import {
  stageHeightFor,
  stageTopFor,
  STAGE,
  STAGE_BOTTOM,
  STAGE_WITH_FIGURE,
  type SceneProps,
} from "./FinanceShell";

/**
 * Die Grafiken selbst.
 *
 * Alle in einer Datei, weil sie sich dieselben acht Zeilen Aufbau teilen —
 * Bühne ausmessen, Höchstwert runden, Gitter zeichnen, Elemente gestaffelt
 * einlaufen lassen. Auf zwölf Dateien verteilt wäre das zwölfmal derselbe
 * Anfang und beim Ändern zwölf Stellen.
 *
 * Was sie gemeinsam haben: nichts erscheint fertig. Ein Balken wächst aus der
 * Achse, eine Kurve zeichnet sich, eine Zahl zählt hoch. Das ist bei
 * Finanzinhalten nicht Zierat — die Bewegung IST oft das Argument, und ein
 * Standbild einer Zinseszinskurve erklärt nichts, was der Text nicht schon
 * gesagt hätte.
 */

/** Wie lange eine Reihe braucht, um sich aufzubauen. */
const BUILD = 26;
/** Zwei Reihen und ein Akzent — mehr Farben verträgt kein Diagramm. */
const SERIES_COLORS = [C.wheat, C.mint, C.signal];

function stage(scene: FinanceScene) {
  return scene.figure ? STAGE_WITH_FIGURE : STAGE;
}

/**
 * Bühne, Höhe und Oberkante in einem Griff.
 *
 * Jede Szene fängt damit an. Die Oberkante steht nicht fest, sondern hängt
 * davon ab, wieviele Zeilen die Überschrift braucht — siehe stageTopFor().
 */
function layout(scene: FinanceScene) {
  const area = stage(scene);
  return { ...area, top: stageTopFor(scene), height: stageHeightFor(scene) };
}

// ---- Große Zahl -----------------------------------------------------------

export const ZahlScene: React.FC<SceneProps<Extract<FinanceScene, { type: "zahl" }>>> = ({
  scene,
  frame,
}) => {
  const { fps } = useVideoConfig();
  // Zählt hoch statt zu erscheinen. Eine Zahl, die läuft, wird angeschaut;
  // eine, die dasteht, wird überlesen.
  const run = drive(frame, fps, 6, 34);
  const value = scene.value * run;
  const caption = enter(frame, fps, 26);
  const box = layout(scene);

  return (
    <>
      <div
        style={{
          position: "absolute",
          left: box.x,
          top: box.top + 60,
          width: box.width,
          ...TYPE.number,
          fontSize: 210,
          lineHeight: 1,
        }}
      >
        {scene.prefix ?? ""}
        {de(value, scene.decimals)}
        {scene.suffix ?? ""}
      </div>
      <div
        style={{
          position: "absolute",
          left: box.x,
          top: box.top + 300,
          width: Math.min(box.width, 1180),
          ...TYPE.caption,
          fontSize: 40,
          lineHeight: 1.35,
          ...caption.style,
          transformOrigin: "left center",
        }}
      >
        {scene.caption}
      </div>
    </>
  );
};

// ---- Balken ---------------------------------------------------------------

export const BalkenScene: React.FC<
  SceneProps<Extract<FinanceScene, { type: "balken" }>>
> = ({ scene, frame }) => {
  const { fps } = useVideoConfig();
  const box = layout(scene);
  const plotWidth = box.width - AXIS_LEFT;
  const labelRoom = 54;
  const plotHeight = box.height - labelRoom;

  const totals = scene.categories.map((c) =>
    scene.stacked ? c.values.reduce((a, b) => a + b, 0) : Math.max(...c.values),
  );
  const scale = axis(Math.max(...totals, 0));
  const max = scale.max;
  const gridProgress = drive(frame, fps, 0, 16);

  const slot = plotWidth / scene.categories.length;
  const groupWidth = slot * 0.62;

  return (
    <>
      <Grid
        x={box.x}
        y={box.top}
        width={box.width}
        height={plotHeight}
        ticks={scale.ticks}
        label={scale.label}
        max={max}
        unit={scene.unit}
        progress={gridProgress}
      />
      {scene.categories.map((category, ci) => {
        const left = box.x + AXIS_LEFT + slot * ci + (slot - groupWidth) / 2;
        const grow = drive(frame, fps, 8 + stagger(ci, 5), BUILD);
        let stackTop = 0;

        return (
          <React.Fragment key={category.label}>
            {category.values.map((value, si) => {
              const height = (value / max) * plotHeight * grow;
              const width = scene.stacked ? groupWidth : groupWidth / category.values.length;
              const x = scene.stacked ? left : left + width * si;
              const bottom = scene.stacked ? stackTop : 0;
              if (scene.stacked) stackTop += height;
              return (
                <div
                  key={si}
                  style={{
                    position: "absolute",
                    left: x,
                    top: box.top + plotHeight - height - bottom,
                    width: width - (scene.stacked ? 0 : 6),
                    height,
                    background: SERIES_COLORS[si % SERIES_COLORS.length],
                    borderRadius: "3px 3px 0 0",
                  }}
                />
              );
            })}
            <AxisLabel
              left={left - slot * 0.19}
              top={box.top + plotHeight + 16}
              width={slot}
              opacity={grow}
            >
              {category.label}
            </AxisLabel>
          </React.Fragment>
        );
      })}
      {scene.series.length > 1 ? (
        <Legend
          names={scene.series}
          x={box.x + AXIS_LEFT}
          y={box.top - 46}
          frame={frame}
        />
      ) : null}
    </>
  );
};

// ---- Verlauf --------------------------------------------------------------

export const LinieScene: React.FC<
  SceneProps<Extract<FinanceScene, { type: "linie" }>>
> = ({ scene, frame }) => {
  const { fps } = useVideoConfig();
  const box = layout(scene);
  const plotWidth = box.width - AXIS_LEFT;
  const labelRoom = 54;
  const plotHeight = box.height - labelRoom;

  const all = scene.series.flatMap((s) => s.points);
  const scale = axis(Math.max(...all, 0));
  const max = scale.max;
  const count = Math.max(...scene.series.map((s) => s.points.length));
  const gridProgress = drive(frame, fps, 0, 16);
  // Die Kurve zeichnet sich von links. Nicht als Effekt: bei einem Verlauf ist
  // die Richtung die Aussage, und ein fertig dastehender Graph nimmt sie weg.
  const draw = drive(frame, fps, 8, 40);

  const px = (i: number) =>
    box.x + AXIS_LEFT + (plotWidth * i) / Math.max(1, count - 1);
  const py = (v: number) => box.top + plotHeight - (v / max) * plotHeight;

  return (
    <>
      <Grid
        x={box.x}
        y={box.top}
        width={box.width}
        height={plotHeight}
        ticks={scale.ticks}
        label={scale.label}
        max={max}
        unit={scene.unit}
        progress={gridProgress}
      />
      <svg
        width={1920}
        height={1080}
        style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}
      >
        {scene.series.map((series, si) => {
          const d = series.points
            .map((v, i) => `${i === 0 ? "M" : "L"}${px(i).toFixed(1)},${py(v).toFixed(1)}`)
            .join(" ");
          return (
            <path
              key={series.name}
              d={d}
              fill="none"
              stroke={SERIES_COLORS[si % SERIES_COLORS.length]}
              strokeWidth={5}
              strokeLinecap="round"
              strokeLinejoin="round"
              // pathLength normiert die Länge auf 1, damit derselbe
              // Strichmuster-Trick für jede Kurve gilt, egal wie lang sie ist.
              pathLength={1}
              strokeDasharray={1}
              strokeDashoffset={1 - draw}
            />
          );
        })}
      </svg>

      {scene.markers.map((marker, mi) => {
        const at = Math.min(count - 1, Math.max(0, marker.at));
        const reached = draw >= at / Math.max(1, count - 1);
        const pop = drive(frame, fps, 8 + (40 * at) / Math.max(1, count - 1), 10);
        if (!reached) return null;
        return (
          <div key={mi} style={{ position: "absolute", left: px(at), top: box.top }}>
            <div
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                width: 1,
                height: plotHeight,
                background: C.signal,
                opacity: 0.45 * pop,
              }}
            />
            <div
              style={{
                position: "absolute",
                left: 10,
                top: 6,
                fontFamily: FONT.body,
                fontWeight: 700,
                fontSize: 22,
                color: C.signal,
                opacity: pop,
                whiteSpace: "nowrap",
              }}
            >
              {marker.label}
            </div>
          </div>
        );
      })}

      {scene.labels.map((label, i) => {
        // Nur so viele Beschriftungen, wie nebeneinander passen.
        const every = Math.ceil(scene.labels.length / 8);
        if (i % every !== 0 && i !== scene.labels.length - 1) return null;
        return (
          <AxisLabel
            key={i}
            left={px(i) - 60}
            top={box.top + plotHeight + 16}
            width={120}
            opacity={gridProgress}
          >
            {label}
          </AxisLabel>
        );
      })}

      {scene.series.length > 1 ? (
        <Legend
          names={scene.series.map((s) => s.name)}
          x={box.x + AXIS_LEFT}
          y={box.top - 46}
          frame={frame}
        />
      ) : null}
    </>
  );
};

// ---- Zinseszins -----------------------------------------------------------

export const ZinseszinsScene: React.FC<
  SceneProps<Extract<FinanceScene, { type: "zinseszins" }>>
> = ({ scene, frame }) => {
  const { fps } = useVideoConfig();
  const box = layout(scene);
  const plotWidth = box.width - AXIS_LEFT;
  // Mehr Fußraum als die anderen Diagramme: unter der Achse steht noch der
  // Satz mit dem Ergebnis, und der lag vorher quer über der Kurve.
  const labelRoom = 148;
  const plotHeight = box.height - labelRoom;

  const { paid, total } = compoundSeries(scene);
  const scale = axis(total[total.length - 1]);
  const max = scale.max;
  const gridProgress = drive(frame, fps, 0, 16);
  const draw = drive(frame, fps, 8, 52);

  const px = (i: number) => box.x + AXIS_LEFT + (plotWidth * i) / scene.years;
  const py = (v: number) => box.top + plotHeight - (v / max) * plotHeight;
  const upto = Math.max(1, Math.round(draw * scene.years));

  const area = [
    ...total.slice(0, upto + 1).map((v, i) => `${i === 0 ? "M" : "L"}${px(i)},${py(v)}`),
    ...paid
      .slice(0, upto + 1)
      .reverse()
      .map((v, i) => `L${px(upto - i)},${py(v)}`),
    "Z",
  ].join(" ");

  const line = (points: number[]) =>
    points
      .slice(0, upto + 1)
      .map((v, i) => `${i === 0 ? "M" : "L"}${px(i)},${py(v)}`)
      .join(" ");

  const gain = total[scene.years] - paid[scene.years];
  const label = enter(frame, fps, 48);

  return (
    <>
      <Grid
        x={box.x}
        y={box.top}
        width={box.width}
        height={plotHeight}
        ticks={scale.ticks}
        label={scale.label}
        max={max}
        unit={scene.currency}
        progress={gridProgress}
      />
      <svg
        width={1920}
        height={1080}
        style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}
      >
        {/* Die Fläche zwischen beiden Linien IST das Argument dieser Szene:
            was der Zins gemacht hat, und wie lange sie nach nichts aussieht. */}
        <path d={area} fill={C.mint} opacity={0.22} />
        <path d={line(paid)} fill="none" stroke={C.muted} strokeWidth={4} strokeDasharray="10 8" />
        <path
          d={line(total)}
          fill="none"
          stroke={C.mint}
          strokeWidth={6}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>

      <div
        style={{
          position: "absolute",
          left: box.x + AXIS_LEFT,
          top: box.top - 46,
          display: "flex",
          gap: 34,
          fontFamily: FONT.body,
          fontWeight: 700,
          fontSize: 24,
          opacity: gridProgress,
        }}
      >
        <span style={{ color: C.muted }}>Eingezahlt</span>
        <span style={{ color: C.mint }}>Mit Zins</span>
      </div>

      <div
        style={{
          position: "absolute",
          left: box.x + AXIS_LEFT,
          top: box.top + plotHeight + 74,
          ...TYPE.caption,
          fontSize: 34,
          ...label.style,
          transformOrigin: "left center",
        }}
      >
        Nach {scene.years} Jahren:{" "}
        <strong style={{ color: C.mint, fontFamily: FONT.mono }}>
          {short(total[scene.years])} {scene.currency}
        </strong>{" "}
        — davon{" "}
        <strong style={{ color: C.wheat, fontFamily: FONT.mono }}>
          {short(gain)} {scene.currency}
        </strong>{" "}
        Zins
      </div>

      {[0, Math.round(scene.years / 2), scene.years].map((year) => (
        <AxisLabel
          key={year}
          left={px(year) - 60}
          top={box.top + plotHeight + 16}
          width={120}
          opacity={gridProgress}
        >
          {year === 0 ? "Start" : `${year} J.`}
        </AxisLabel>
      ))}
    </>
  );
};

// ---- Gemeinsames ----------------------------------------------------------

const Legend: React.FC<{
  names: string[];
  x: number;
  y: number;
  frame: number;
}> = ({ names, x, y, frame }) => {
  const { fps } = useVideoConfig();
  const show = drive(frame, fps, 4, 14);
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        display: "flex",
        gap: 30,
        opacity: show,
      }}
    >
      {names.map((name, i) => (
        <span
          key={name}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 9,
            fontFamily: FONT.body,
            fontWeight: 700,
            fontSize: 24,
            color: C.ink,
          }}
        >
          <span
            style={{
              width: 20,
              height: 6,
              borderRadius: 3,
              background: SERIES_COLORS[i % SERIES_COLORS.length],
            }}
          />
          {name}
        </span>
      ))}
    </div>
  );
};

// ---- Gegenüberstellung ----------------------------------------------------

export const VergleichScene: React.FC<
  SceneProps<Extract<FinanceScene, { type: "vergleich" }>>
> = ({ scene, frame }) => {
  const { fps } = useVideoConfig();
  const box = layout(scene);
  const gap = 56;
  const colWidth = (box.width - gap) / 2;
  const rows = Math.max(scene.left.rows.length, scene.right.rows.length);
  const verdict = enter(frame, fps, 10 + rows * 5);
  // Bei drei Zeilen stand vorher ein Drittel der Fläche voll und zwei Drittel
  // leer. Der Abstand wächst mit, bis er großzügig ist, und deckelt dann.
  const rowHeight = Math.min(132, Math.max(74, (box.height - 200) / rows));

  const column = (
    side: { title: string; rows: string[] },
    x: number,
    accent: string,
  ) => (
    <>
      <div
        style={{
          position: "absolute",
          left: x,
          top: box.top - 10,
          width: colWidth,
          fontFamily: FONT.display,
          fontWeight: 700,
          fontSize: 42,
          letterSpacing: "-0.01em",
          color: accent,
          opacity: drive(frame, fps, 2, 14),
        }}
      >
        {side.title}
      </div>
      {side.rows.map((row, i) => {
        const step = enter(frame, fps, 10 + stagger(i, 5));
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: x,
              top: box.top + 66 + i * rowHeight,
              width: colWidth,
              display: "flex",
              gap: 16,
              alignItems: "flex-start",
              ...step.style,
              transformOrigin: "left center",
            }}
          >
            <span
              style={{
                marginTop: 13,
                width: 10,
                height: 10,
                flexShrink: 0,
                borderRadius: 5,
                background: accent,
              }}
            />
            <span
              style={{
                fontFamily: FONT.body,
                fontWeight: 500,
                fontSize: 30,
                lineHeight: 1.3,
                color: C.ink,
              }}
            >
              {row}
            </span>
          </div>
        );
      })}
    </>
  );

  return (
    <>
      {column(scene.left, box.x, C.wheat)}
      {/* Die Trennlinie wächst mit, statt dazustehen: sie ist die Behauptung,
          dass hier zwei Dinge gegeneinander stehen, und die baut sich auf. */}
      <div
        style={{
          position: "absolute",
          left: box.x + colWidth + gap / 2,
          top: box.top - 10,
          width: 1,
          height: (66 + rows * rowHeight - 20) * drive(frame, fps, 4, 20),
          background: C.muted,
          opacity: 0.3,
        }}
      />
      {column(scene.right, box.x + colWidth + gap, C.mint)}

      {scene.verdict ? (
        <div
          style={{
            position: "absolute",
            left: box.x,
            top: STAGE_BOTTOM - 74,
            width: box.width,
            ...TYPE.caption,
            fontSize: 34,
            ...verdict.style,
            transformOrigin: "left center",
          }}
        >
          {scene.verdict}
        </div>
      ) : null}
    </>
  );
};

// ---- Wasserfall -----------------------------------------------------------

export const WasserfallScene: React.FC<
  SceneProps<Extract<FinanceScene, { type: "wasserfall" }>>
> = ({ scene, frame }) => {
  const { fps } = useVideoConfig();
  const box = layout(scene);
  const plotWidth = box.width - AXIS_LEFT;
  const labelRoom = 92;
  const plotHeight = box.height - labelRoom;

  // Jede Stufe kennt ihren Fuß und ihren Kopf. Die Reihenfolge ist die
  // Rechnung, und deshalb laufen sie nacheinander ein und nicht zugleich.
  type Bar = {
    label: string;
    from: number;
    to: number;
    /** Der Zwischenstand NACH dieser Stufe — daran hängen die Verbinder. */
    after: number;
    kind: "start" | "up" | "down" | "end";
  };
  const bars: Bar[] = [
    {
      label: scene.start.label,
      from: 0,
      to: scene.start.value,
      after: scene.start.value,
      kind: "start",
    },
  ];
  let running = scene.start.value;
  for (const step of scene.steps) {
    const next = running + step.delta;
    bars.push({
      label: step.label,
      from: Math.min(running, next),
      to: Math.max(running, next),
      after: next,
      kind: step.delta < 0 ? "down" : "up",
    });
    running = next;
  }
  bars.push({ label: scene.endLabel, from: 0, to: running, after: running, kind: "end" });

  const scale = axis(Math.max(...bars.map((b) => b.to), 0));
  const max = scale.max;
  const gridProgress = drive(frame, fps, 0, 16);
  const slot = plotWidth / bars.length;
  const width = slot * 0.6;

  const colorOf = (kind: string) =>
    kind === "down" ? C.signal : kind === "end" ? C.mint : C.wheat;

  return (
    <>
      <Grid
        x={box.x}
        y={box.top}
        width={box.width}
        height={plotHeight}
        ticks={scale.ticks}
        label={scale.label}
        max={max}
        unit={scene.currency}
        progress={gridProgress}
      />
      {/*
        Die gestrichelten Verbinder. Ohne sie sind das fünf Balken, die zufällig
        auf verschiedenen Höhen schweben; mit ihnen ist es eine Rechnung.
      */}
      {bars.slice(0, -1).map((bar, i) => {
        const show = drive(frame, fps, 14 + stagger(i, 7), 12);
        return (
          <div
            key={`link-${i}`}
            style={{
              position: "absolute",
              left: box.x + AXIS_LEFT + slot * i + (slot + width) / 2,
              top: box.top + plotHeight - (bar.after / max) * plotHeight,
              width: (slot - width) * show,
              borderTop: `2px dashed ${C.muted}`,
              opacity: 0.5,
            }}
          />
        );
      })}
      {bars.map((bar, i) => {
        const grow = drive(frame, fps, 8 + stagger(i, 7), 18);
        const left = box.x + AXIS_LEFT + slot * i + (slot - width) / 2;
        const height = ((bar.to - bar.from) / max) * plotHeight * grow;
        return (
          <React.Fragment key={i}>
            <div
              style={{
                position: "absolute",
                left,
                top: box.top + plotHeight - (bar.from / max) * plotHeight - height,
                width,
                height,
                background: colorOf(bar.kind),
                borderRadius: 3,
              }}
            />
            <div
              style={{
                position: "absolute",
                left: left - slot * 0.2,
                top:
                  box.top +
                  plotHeight -
                  (bar.to / max) * plotHeight -
                  40,
                width: slot,
                textAlign: "center",
                fontFamily: FONT.mono,
                fontWeight: 700,
                fontSize: 24,
                fontVariantNumeric: "tabular-nums",
                color: colorOf(bar.kind),
                opacity: grow,
              }}
            >
              {bar.kind === "down" ? "−" : ""}
              {short(bar.to - bar.from)}
            </div>
            <AxisLabel
              left={left - slot * 0.2}
              top={box.top + plotHeight + 16}
              width={slot}
              opacity={grow}
              strong={bar.kind === "end"}
            >
              {bar.label}
            </AxisLabel>
          </React.Fragment>
        );
      })}
    </>
  );
};

// ---- Aufteilung -----------------------------------------------------------

export const AufteilungScene: React.FC<
  SceneProps<Extract<FinanceScene, { type: "aufteilung" }>>
> = ({ scene, frame }) => {
  const { fps } = useVideoConfig();
  const box = layout(scene);
  const total = scene.parts.reduce((a, p) => a + p.value, 0) || 1;
  const asRing = resolveAufteilung(scene);
  const sweep = drive(frame, fps, 6, 34);

  const palette = [C.wheat, C.mint, C.signal, "#6E8CB5", "#B58B6E", "#8A7EA8"];

  if (!asRing) {
    // Über vier Teilen ist ein gestapelter Balken lesbar und ein Ring nicht.
    // Siehe resolveAufteilung() — die Entscheidung trifft nicht das Modell.
    let offset = 0;
    return (
      <>
        <div
          style={{
            position: "absolute",
            left: box.x,
            top: box.top + 60,
            width: box.width,
            height: 96,
            display: "flex",
            borderRadius: 6,
            overflow: "hidden",
          }}
        >
          {scene.parts.map((part, i) => {
            const share = (part.value / total) * sweep;
            return (
              <div
                key={part.label}
                style={{
                  width: `${share * 100}%`,
                  background: palette[i % palette.length],
                }}
              />
            );
          })}
        </div>
        {scene.parts.map((part, i) => {
          offset += 1;
          const row = enter(frame, fps, 14 + stagger(i, 5));
          return (
            <div
              key={part.label}
              style={{
                position: "absolute",
                left: box.x,
                top: box.top + 200 + i * 62,
                width: box.width,
                display: "flex",
                alignItems: "center",
                gap: 16,
                ...row.style,
                transformOrigin: "left center",
              }}
            >
              <span
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 4,
                  background: palette[i % palette.length],
                }}
              />
              <span style={{ fontFamily: FONT.body, fontWeight: 500, fontSize: 30, color: C.ink }}>
                {part.label}
              </span>
              <span
                style={{
                  marginLeft: "auto",
                  fontFamily: FONT.mono,
                  fontWeight: 700,
                  fontSize: 30,
                  fontVariantNumeric: "tabular-nums",
                  color: palette[i % palette.length],
                }}
              >
                {withUnit(part.value, scene.unit)}
              </span>
            </div>
          );
        })}
        {offset ? null : null}
      </>
    );
  }

  const cx = box.x + 300;
  const cy = box.top + box.height / 2 - 30;
  const radius = 190;
  const thickness = 62;
  let angle = -Math.PI / 2;

  return (
    <>
      <svg width={1920} height={1080} style={{ position: "absolute", left: 0, top: 0 }}>
        {scene.parts.map((part, i) => {
          const span = (part.value / total) * Math.PI * 2 * sweep;
          const from = angle;
          angle += (part.value / total) * Math.PI * 2;
          const to = from + span;
          const large = span > Math.PI ? 1 : 0;
          const p = (r: number, a: number) =>
            `${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`;
          if (span <= 0.0001) return null;
          return (
            <path
              key={part.label}
              d={[
                `M${p(radius, from)}`,
                `A${radius},${radius} 0 ${large} 1 ${p(radius, to)}`,
                `L${p(radius - thickness, to)}`,
                `A${radius - thickness},${radius - thickness} 0 ${large} 0 ${p(radius - thickness, from)}`,
                "Z",
              ].join(" ")}
              fill={palette[i % palette.length]}
            />
          );
        })}
      </svg>
      {scene.parts.map((part, i) => {
        const row = enter(frame, fps, 16 + stagger(i, 6));
        return (
          <div
            key={part.label}
            style={{
              position: "absolute",
              left: cx + radius + 90,
              top: cy - (scene.parts.length * 74) / 2 + i * 74,
              width: box.width - (cx - box.x) - radius - 90,
              display: "flex",
              alignItems: "center",
              gap: 16,
              ...row.style,
              transformOrigin: "left center",
            }}
          >
            <span
              style={{
                width: 22,
                height: 22,
                borderRadius: 4,
                background: palette[i % palette.length],
              }}
            />
            <span style={{ fontFamily: FONT.body, fontWeight: 500, fontSize: 32, color: C.ink }}>
              {part.label}
            </span>
            <span
              style={{
                marginLeft: "auto",
                fontFamily: FONT.mono,
                fontWeight: 700,
                fontSize: 32,
                fontVariantNumeric: "tabular-nums",
                color: palette[i % palette.length],
              }}
            >
              {Math.round((part.value / total) * 100)} %
            </span>
          </div>
        );
      })}
    </>
  );
};

// ---- Geldfluss ------------------------------------------------------------

export const FlussScene: React.FC<
  SceneProps<Extract<FinanceScene, { type: "fluss" }>>
> = ({ scene, frame }) => {
  const { fps } = useVideoConfig();
  const box = layout(scene);
  const gap = 44;
  const width = (box.width - gap * (scene.nodes.length - 1)) / scene.nodes.length;
  const top = box.top + 70;
  const height = 190;

  return (
    <>
      {scene.nodes.map((node, i) => {
        const step = enter(frame, fps, 6 + stagger(i, 9));
        const left = box.x + (width + gap) * i;
        const last = i === scene.nodes.length - 1;
        return (
          <React.Fragment key={node.label}>
            <div
              style={{
                position: "absolute",
                left,
                top,
                width,
                height,
                background: last ? C.mint : C.bgAlt,
                border: `2px solid ${last ? C.mint : C.muted}`,
                borderRadius: 8,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 10,
                ...step.style,
              }}
            >
              <span
                style={{
                  fontFamily: FONT.body,
                  fontWeight: 700,
                  fontSize: 28,
                  color: last ? C.bg : C.ink,
                  textAlign: "center",
                  padding: "0 14px",
                }}
              >
                {node.label}
              </span>
              {node.value !== undefined ? (
                <span
                  style={{
                    fontFamily: FONT.mono,
                    fontWeight: 700,
                    fontSize: 38,
                    fontVariantNumeric: "tabular-nums",
                    color: last ? C.bg : C.wheat,
                  }}
                >
                  {short(node.value)} {scene.currency}
                </span>
              ) : null}
            </div>
            {i < scene.nodes.length - 1 ? (
              // Der Pfeil erscheint NACH seinem Kasten und VOR dem nächsten:
              // die Reihenfolge ist die Aussage, das Geld geht in eine Richtung.
              <div
                style={{
                  position: "absolute",
                  left: left + width + 12,
                  top: top + height / 2 - 12,
                  fontFamily: FONT.display,
                  fontSize: 30,
                  color: C.muted,
                  opacity: drive(frame, fps, 12 + stagger(i, 9), 10),
                }}
              >
                →
              </div>
            ) : null}
          </React.Fragment>
        );
      })}
    </>
  );
};

// ---- Zeitstrahl -----------------------------------------------------------

export const ZeitstrahlScene: React.FC<
  SceneProps<Extract<FinanceScene, { type: "zeitstrahl" }>>
> = ({ scene, frame }) => {
  const { fps } = useVideoConfig();
  const box = layout(scene);
  const line = drive(frame, fps, 2, 24);
  const top = box.top + 40;
  const rowHeight = Math.min(96, (box.height - 90) / scene.events.length);

  return (
    <>
      <div
        style={{
          position: "absolute",
          left: box.x + 138,
          top,
          width: 3,
          height: rowHeight * (scene.events.length - 1) * line,
          background: C.muted,
          opacity: 0.4,
        }}
      />
      {scene.events.map((event, i) => {
        const step = enter(frame, fps, 8 + stagger(i, 6));
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: box.x,
              top: top + i * rowHeight - 20,
              width: box.width,
              display: "flex",
              alignItems: "center",
              gap: 26,
              ...step.style,
              transformOrigin: "left center",
            }}
          >
            <span
              style={{
                width: 120,
                textAlign: "right",
                fontFamily: FONT.mono,
                fontWeight: 700,
                fontSize: 32,
                fontVariantNumeric: "tabular-nums",
                color: C.wheat,
              }}
            >
              {event.year}
            </span>
            <span
              style={{
                width: 15,
                height: 15,
                flexShrink: 0,
                borderRadius: 8,
                background: C.wheat,
              }}
            />
            <span
              style={{
                fontFamily: FONT.body,
                fontWeight: 500,
                fontSize: 30,
                lineHeight: 1.3,
                color: C.ink,
              }}
            >
              {event.label}
            </span>
          </div>
        );
      })}
    </>
  );
};

// ---- Tabelle --------------------------------------------------------------

export const TabelleScene: React.FC<
  SceneProps<Extract<FinanceScene, { type: "tabelle" }>>
> = ({ scene, frame }) => {
  const { fps } = useVideoConfig();
  const box = layout(scene);
  const colWidth = box.width / scene.columns.length;
  const top = box.top + 20;
  const rowHeight = Math.min(84, (box.height - 100) / (scene.rows.length + 1));

  const cell = (text: string, ci: number, strong: boolean) => ({
    position: "absolute" as const,
    left: box.x + colWidth * ci + (ci === 0 ? 0 : 14),
    width: colWidth - 14,
    textAlign: ci === 0 ? ("left" as const) : ("right" as const),
    fontFamily: ci === 0 ? FONT.body : FONT.mono,
    fontWeight: strong ? 700 : 500,
    fontSize: 30,
    fontVariantNumeric: "tabular-nums" as const,
    color: strong ? C.ink : ci === 0 ? C.ink : C.wheat,
  });

  return (
    <>
      {scene.columns.map((column, ci) => (
        <div
          key={column}
          style={{
            ...cell(column, ci, true),
            top,
            color: C.muted,
            fontSize: 25,
            letterSpacing: "0.03em",
            textTransform: "uppercase",
            opacity: drive(frame, fps, 2, 14),
          }}
        >
          {column}
        </div>
      ))}
      <div
        style={{
          position: "absolute",
          left: box.x,
          top: top + 44,
          width: box.width * drive(frame, fps, 4, 18),
          height: 1,
          background: C.muted,
          opacity: 0.4,
        }}
      />
      {scene.rows.map((row, ri) =>
        row.map((value, ci) => (
          <div
            key={`${ri}-${ci}`}
            style={{
              ...cell(value, ci, ci === 0),
              top: top + 72 + ri * rowHeight,
              opacity: drive(frame, fps, 10 + stagger(ri, 5), 14),
            }}
          >
            {value}
          </div>
        )),
      )}
    </>
  );
};

// ---- Rechnung -------------------------------------------------------------

export const FormelScene: React.FC<
  SceneProps<Extract<FinanceScene, { type: "formel" }>>
> = ({ scene, frame }) => {
  const { fps } = useVideoConfig();
  const box = layout(scene);
  const top = box.top + 30;
  const rowHeight = Math.min(112, (box.height - 120) / (scene.steps.length + 1));
  const result = enter(frame, fps, 12 + scene.steps.length * 8);

  return (
    <>
      {scene.steps.map((step, i) => {
        const show = enter(frame, fps, 8 + stagger(i, 8));
        return (
          <React.Fragment key={i}>
            <div
              style={{
                position: "absolute",
                left: box.x,
                top: top + i * rowHeight,
                fontFamily: FONT.mono,
                fontWeight: 700,
                fontSize: 46,
                fontVariantNumeric: "tabular-nums",
                color: C.ink,
                ...show.style,
                transformOrigin: "left center",
              }}
            >
              {step.expression}
            </div>
            {step.note ? (
              <div
                style={{
                  position: "absolute",
                  left: box.x + 720,
                  top: top + i * rowHeight + 12,
                  width: box.width - 720,
                  fontFamily: FONT.body,
                  fontWeight: 500,
                  fontSize: 26,
                  color: C.muted,
                  opacity: show.opacity,
                }}
              >
                {step.note}
              </div>
            ) : null}
          </React.Fragment>
        );
      })}
      {scene.result ? (
        <div
          style={{
            position: "absolute",
            left: box.x,
            top: top + scene.steps.length * rowHeight + 18,
            paddingTop: 22,
            borderTop: `2px solid ${C.wheat}`,
            width: 660,
            fontFamily: FONT.mono,
            fontWeight: 700,
            fontSize: 56,
            fontVariantNumeric: "tabular-nums",
            color: C.wheat,
            ...result.style,
            transformOrigin: "left center",
          }}
        >
          {scene.result}
        </div>
      ) : null}
    </>
  );
};

// ---- Aussage --------------------------------------------------------------

export const AussageScene: React.FC<
  SceneProps<Extract<FinanceScene, { type: "aussage" }>>
> = ({ scene, frame }) => {
  const { fps } = useVideoConfig();
  const box = layout(scene);
  const show = enter(frame, fps, 6);
  const who = enter(frame, fps, 16);

  return (
    <>
      <div
        style={{
          position: "absolute",
          left: box.x,
          top: box.top + 40,
          width: Math.min(box.width, 1440),
          fontFamily: FONT.display,
          fontWeight: 700,
          fontSize: 62,
          lineHeight: 1.25,
          letterSpacing: "-0.01em",
          color: C.ink,
          ...show.style,
          transformOrigin: "left center",
        }}
      >
        {scene.text}
      </div>
      {scene.attribution ? (
        <div
          style={{
            position: "absolute",
            left: box.x,
            top: box.top + 40 + 240,
            ...TYPE.label,
            ...who.style,
            transformOrigin: "left center",
          }}
        >
          — {scene.attribution}
        </div>
      ) : null}
    </>
  );
};
