import React from "react";
import { interpolate, useVideoConfig } from "remotion";
import type { Scene } from "../../lib/schema";
import type { SceneRenderProps } from "../shared/SceneShell";
import { C, FONT, TYPE } from "../shared/Tokens";
import { drive } from "../shared/motion";

type MapScene = Extract<Scene, { type: "mapFlow" }>;

const VIEW = { w: 1000, h: 700 };
const DRAW_FRAMES = 30;

/**
 * Europe as a set of stylised regions rather than one traced coastline.
 *
 * Drawn by hand — a real geo dataset would fight the flat-vector style and cost
 * far more than it adds at this size. Splitting the continent into blocks makes
 * the recognisable parts (Iberia, the boot, Scandinavia, the British Isles)
 * legible at a glance, which a single simplified outline never manages.
 */
const EUROPE_REGIONS = [
  // Iberia
  "M120 432 L212 414 L254 452 L240 505 L184 530 L134 510 L110 470 Z",
  // France
  "M225 300 L300 290 L332 344 L316 400 L256 420 L214 414 L205 354 Z",
  // Britain
  "M175 235 L215 225 L231 270 L214 300 L180 286 L165 256 Z",
  // Ireland
  "M128 255 L162 248 L168 282 L136 290 Z",
  // Scandinavia
  "M330 205 L365 110 L415 80 L455 106 L450 166 L410 206 L364 230 Z",
  // Finland and the Baltic north
  "M455 106 L506 95 L526 150 L490 190 L450 166 Z",
  // Central Europe
  "M300 290 L390 250 L470 246 L500 300 L470 350 L400 366 L332 344 Z",
  // Eastern Europe
  "M500 300 L560 240 L650 226 L760 240 L790 300 L740 356 L650 370 L560 356 L505 330 Z",
  // Balkans and Greece
  "M470 350 L560 356 L620 396 L610 456 L576 500 L546 456 L520 410 L490 396 Z",
  // Italy
  "M420 355 L456 372 L462 420 L440 470 L420 520 L402 566 L384 556 L400 512 L418 462 L428 418 L405 378 Z",
  // Sicily
  "M356 576 L386 570 L370 596 Z",
];

const WORLD_BLOB =
  "M60 300 L190 210 L330 250 L470 190 L640 220 L820 200 L940 280 L900 420 L760 470 L600 430 L440 470 L280 440 L140 470 Z";

/** Approximate positions, normalised to the 1000x700 viewBox. */
const PLACES: Record<string, [number, number]> = {
  deutschland: [400, 300],
  germany: [400, 300],
  berlin: [400, 300],
  frankreich: [265, 350],
  france: [265, 350],
  paris: [265, 350],
  spanien: [185, 470],
  spain: [185, 470],
  madrid: [185, 470],
  portugal: [132, 470],
  italien: [430, 468],
  italy: [430, 468],
  rom: [430, 468],
  polen: [470, 292],
  poland: [470, 292],
  ukraine: [640, 300],
  russland: [750, 276],
  russia: [750, 276],
  moskau: [750, 276],
  niederlande: [305, 300],
  belgien: [296, 322],
  grossbritannien: [197, 262],
  uk: [197, 262],
  london: [197, 262],
  irland: [148, 268],
  norwegen: [386, 152],
  schweden: [424, 152],
  finnland: [490, 140],
  daenemark: [350, 252],
  griechenland: [580, 468],
  athen: [580, 468],
  tuerkei: [700, 430],
  rumaenien: [590, 348],
  oesterreich: [440, 330],
  wien: [440, 330],
  schweiz: [386, 344],
  ungarn: [510, 334],
  tschechien: [450, 310],
  belarus: [620, 266],
  eu: [430, 320],
  europa: [430, 320],
  europe: [430, 320],
  nordafrika: [350, 660],
  afrika: [350, 660],
  africa: [350, 660],
  suedamerika: [80, 640],
  brasilien: [80, 640],
  argentinien: [92, 664],
  usa: [50, 330],
  nordamerika: [50, 330],
  china: [900, 430],
  asien: [900, 430],
  indien: [880, 500],
  australien: [900, 650],
  welt: [500, 350],
  world: [500, 350],
  global: [500, 350],
  schwarzmeer: [680, 390],
  mittelmeer: [420, 600],
  nordsee: [290, 240],
  atlantik: [60, 380],
  import: [60, 380],
  export: [880, 330],
};

/** Strip accents and punctuation so "Österreich" and "Oesterreich" both hit. */
function keyOf(name: string): string {
  return name
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z]/g, "");
}

/**
 * Resolve a place name to a point. Unknown names get a stable pseudo-random
 * position from a hash rather than collapsing to the centre — an unrecognised
 * country still produces a readable, repeatable diagram.
 */
function pointOf(name: string): [number, number] {
  const key = keyOf(name);
  if (PLACES[key]) return PLACES[key];

  const partial = Object.keys(PLACES).find(
    (k) => k.startsWith(key) || key.startsWith(k),
  );
  if (partial) return PLACES[partial];

  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  }
  const angle = (hash % 360) * (Math.PI / 180);
  return [500 + Math.cos(angle) * 320, 340 + Math.sin(angle) * 190];
}

export const MapFlow: React.FC<SceneRenderProps<MapScene>> = ({
  scene,
  frame,
  accent,
}) => {
  const { fps } = useVideoConfig();
  const shapeIn = drive(frame, fps, 0);

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
            marginBottom: 16,
            opacity: drive(frame, fps, 0),
          }}
        >
          {scene.headline}
        </div>
      ) : null}

      <svg viewBox={`0 0 ${VIEW.w} ${VIEW.h}`} width="100%" height="76%">
        <g
          opacity={shapeIn}
          fill={C.bgAlt}
          stroke={C.muted}
          strokeWidth={2}
          strokeLinejoin="round"
        >
          {scene.region === "europe" ? (
            EUROPE_REGIONS.map((d, i) => <path key={i} d={d} />)
          ) : (
            <path d={WORLD_BLOB} />
          )}
        </g>

        {scene.flows.map((flow, i) => {
          const [x1, y1] = pointOf(flow.from);
          const [x2, y2] = pointOf(flow.to);

          // Bow the line away from the straight connection so parallel flows
          // stay distinguishable.
          const mx = (x1 + x2) / 2;
          const my = (y1 + y2) / 2;
          const dx = x2 - x1;
          const dy = y2 - y1;
          const length = Math.hypot(dx, dy) || 1;
          const bow = Math.min(140, length * 0.28);
          const cx = mx - (dy / length) * bow;
          const cy = my + (dx / length) * bow;

          const delay = i * 6;
          const draw = interpolate(
            frame,
            [delay, delay + DRAW_FRAMES],
            [0, 1],
            { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
          );

          // Arrowhead points along the tangent at the curve's end.
          const angle =
            (Math.atan2(y2 - cy, x2 - cx) * 180) / Math.PI;

          return (
            <g key={`${flow.from}-${flow.to}-${i}`}>
              <path
                d={`M${x1} ${y1} Q${cx} ${cy} ${x2} ${y2}`}
                fill="none"
                stroke={accent}
                strokeWidth={4}
                strokeLinecap="round"
                pathLength={1}
                strokeDasharray={1}
                strokeDashoffset={1 - draw}
              />
              <circle cx={x1} cy={y1} r={7} fill={accent} opacity={draw > 0 ? 1 : 0} />
              <g
                transform={`translate(${x2} ${y2}) rotate(${angle})`}
                opacity={draw >= 0.99 ? 1 : 0}
              >
                <path d="M-16 -9 L2 0 L-16 9 Z" fill={accent} />
              </g>
              {flow.label ? (
                <text
                  x={cx}
                  y={cy - 14}
                  textAnchor="middle"
                  fill={C.ink}
                  opacity={draw}
                  style={{
                    fontFamily: FONT.mono,
                    fontWeight: 700,
                    fontSize: 24,
                  }}
                >
                  {flow.label}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>

      {scene.sub ? (
        <div style={{ ...TYPE.sub, marginTop: 8, opacity: drive(frame, fps, 12) }}>
          {scene.sub}
        </div>
      ) : null}
    </div>
  );
};
