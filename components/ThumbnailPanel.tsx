"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import type { ThumbnailConfig } from "../lib/thumbnail";
import { getJson, postJson } from "./api";
import { Button, Note, Panel } from "./ui";

/**
 * The thumbnail.
 *
 * Composited in the browser on a canvas: the background is a photograph when
 * one has been generated and a flat colour otherwise, and every word on top of
 * it is drawn here rather than asked of the image model. That split is the
 * whole design. Image models still mangle German — a headline reading
 * "ERRAETN" is worse than no thumbnail — and text drawn on the canvas stays
 * crisp, editable, and free to change a hundred times.
 *
 * Only the picture costs anything, and only when it is asked for.
 */

const W = 1280;
const H = 720;

type Skin = { name: string; bg: string; ink: string; mark: string };

/**
 * Bright, flat, high contrast — a thumbnail is looked at for a fifth of a
 * second at the size of a postage stamp, so subtlety is wasted on it.
 */
const SKINS: Skin[] = [
  { name: "Türkis", bg: "#A8F0EA", ink: "#101418", mark: "#F5A8E0" },
  { name: "Gelb", bg: "#F2ED64", ink: "#101418", mark: "#B9A6FF" },
  { name: "Koralle", bg: "#FFB3A7", ink: "#101418", mark: "#9BE8FF" },
  { name: "Limette", bg: "#C6F26A", ink: "#101418", mark: "#FFB3E6" },
  { name: "Nachtblau", bg: "#132B54", ink: "#FFFFFF", mark: "#FFD166" },
  { name: "Schwarz", bg: "#101418", ink: "#FFFFFF", mark: "#F2ED64" },
];

const LAYOUTS = [
  { id: "split", label: "Text links, Bild rechts" },
  { id: "full", label: "Bild vollflächig, Text darüber" },
  { id: "bottom", label: "Bild oben, Text unten" },
] as const;
type Layout = (typeof LAYOUTS)[number]["id"];

async function loadImage(src: string): Promise<HTMLImageElement | null> {
  try {
    const img = new Image();
    // Generated backgrounds live on the Blob domain; without this the canvas
    // is tainted and toBlob throws instead of producing a file.
    img.crossOrigin = "anonymous";
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error(src));
      img.src = src;
    });
    return img;
  } catch {
    return null;
  }
}

/**
 * Draw an SVG file onto a canvas.
 *
 * Re-serialised with explicit dimensions: these flags carry only a viewBox,
 * and a browser handed an SVG with no intrinsic size may draw nothing at all.
 */
async function loadFlag(code: string): Promise<HTMLImageElement | null> {
  try {
    const res = await fetch(`/flags/${code}.svg`);
    if (!res.ok) return null;
    const svg = (await res.text()).replace("<svg", '<svg width="640" height="480"');
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    const img = await loadImage(url);
    URL.revokeObjectURL(url);
    return img;
  } catch {
    return null;
  }
}

/** Three words a line, upper case — a headline is read in a glance. */
function headlineFrom(title: string): string {
  const words = title.toUpperCase().replace(/\s+/g, " ").trim().split(" ");
  const out: string[] = [];
  for (let i = 0; i < words.length; i += 3) out.push(words.slice(i, i + 3).join(" "));
  return out.slice(0, 4).join("\n");
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** The hand-drawn arrow from the headline towards the subject. */
function drawArrow(ctx: CanvasRenderingContext2D, colour: string) {
  ctx.save();
  ctx.strokeStyle = colour;
  ctx.lineWidth = 12;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(560, 250);
  ctx.bezierCurveTo(640, 210, 700, 240, 730, 300);
  ctx.stroke();
  // The head, as two strokes rather than a filled triangle — it keeps the
  // drawn-by-hand feel the reference has.
  ctx.beginPath();
  ctx.moveTo(730, 300);
  ctx.lineTo(700, 268);
  ctx.moveTo(730, 300);
  ctx.lineTo(696, 306);
  ctx.stroke();
  ctx.restore();
}

type JobState = {
  status: "running" | "done" | "error";
  imageUrl?: string;
  error?: string;
};

export const ThumbnailPanel: React.FC<{
  step: string;
  /** Two-letter codes, drawn when there is no generated background. */
  flags: string[];
  /** Seeds the headline and the image prompt the first time. */
  defaultTitle: string;
  topic: string;
  slug: string;
  /** Persisted with the project, so an expensive picture survives a reload. */
  config: ThumbnailConfig | undefined;
  onChange: (config: ThumbnailConfig) => void;
}> = ({ step, flags, defaultTitle, topic, slug, config, onChange }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const lines = config?.lines ?? headlineFrom(defaultTitle);
  const skinIndex = config?.skin ?? 0;
  const marked = config?.marked ?? 1;
  const layout: Layout = (config?.layout as Layout) ?? "split";
  const arrow = config?.arrow ?? false;
  const outline = config?.outline ?? true;
  const imageUrl = config?.imageUrl;
  const imagePrompt =
    config?.imagePrompt ?? `${topic || defaultTitle}, als Titelbild für ein Video`;

  const set = (patch: Partial<ThumbnailConfig>) =>
    onChange({
      lines,
      skin: skinIndex,
      marked,
      layout,
      arrow,
      outline,
      imageUrl,
      imagePrompt,
      ...patch,
    });

  // The poll below finishes up to a minute after it started, and by then the
  // `set` it captured describes a config the user has since edited. Going
  // through a ref means an arriving picture cannot roll back a headline that
  // was typed while it was being drawn.
  const setRef = useRef(set);
  setRef.current = set;

  // ---- Generation ---------------------------------------------------------
  async function generate() {
    setBusy(true);
    setError(null);
    const result = await postJson<{ jobId: string }>("/api/thumbnail", {
      prompt: imagePrompt,
      // The canvas crops to fill, so the model is told which crop is coming.
      layout,
    });
    if (!result.ok) {
      setError(result.error);
      setBusy(false);
      return;
    }
    setJobId(result.data.jobId);
  }

  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;
    const tick = async () => {
      const result = await getJson<JobState>(
        `/api/thumbnail?jobId=${encodeURIComponent(jobId)}`,
      );
      if (cancelled || !result.ok) return;
      if (result.data.status === "running") return;

      if (result.data.status === "done" && result.data.imageUrl) {
        setRef.current({ imageUrl: result.data.imageUrl });
      } else {
        setError(result.data.error ?? "Das Bild konnte nicht erzeugt werden.");
      }
      setJobId(null);
      setBusy(false);
    };
    void tick();
    const id = window.setInterval(() => void tick(), 2000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [jobId]);

  // ---- Drawing ------------------------------------------------------------
  const draw = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const skin = SKINS[skinIndex] ?? SKINS[0];
    await document.fonts.ready.catch(() => undefined);

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = skin.bg;
    ctx.fillRect(0, 0, W, H);

    const photo = imageUrl ? await loadImage(imageUrl) : null;

    // Where the words go and where the picture goes, per layout.
    let column = W - 128;
    let textTop = 0;
    let textHeight = H;

    if (photo) {
      if (layout === "full") {
        // Cover, not stretch: an image squeezed to 16:9 looks like a mistake.
        const scale = Math.max(W / photo.width, H / photo.height);
        ctx.drawImage(
          photo,
          (W - photo.width * scale) / 2,
          (H - photo.height * scale) / 2,
          photo.width * scale,
          photo.height * scale,
        );
        // Darkened on the left so white text has something to sit on.
        const shade = ctx.createLinearGradient(0, 0, W * 0.85, 0);
        shade.addColorStop(0, "rgba(0,0,0,0.72)");
        shade.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = shade;
        ctx.fillRect(0, 0, W, H);
        column = 620;
      } else if (layout === "bottom") {
        const h = Math.round(H * 0.56);
        const scale = Math.max(W / photo.width, h / photo.height);
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, W, h);
        ctx.clip();
        ctx.drawImage(
          photo,
          (W - photo.width * scale) / 2,
          (h - photo.height * scale) / 2,
          photo.width * scale,
          photo.height * scale,
        );
        ctx.restore();
        textTop = h;
        textHeight = H - h;
        column = W - 128;
      } else {
        const x = Math.round(W * 0.46);
        const w = W - x;
        const scale = Math.max(w / photo.width, H / photo.height);
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, 0, w, H);
        ctx.clip();
        ctx.drawImage(
          photo,
          x + (w - photo.width * scale) / 2,
          (H - photo.height * scale) / 2,
          photo.width * scale,
          photo.height * scale,
        );
        ctx.restore();
        column = x - 128;
      }
    } else {
      // No photograph: a light from the top left so a flat colour does not
      // read as a screenshot of a colour, and the flags as the subject.
      //
      // Much weaker on the dark palettes. At the strength the pale ones want,
      // the same white wash turned black into a flat middle grey and threw
      // away the one thing a dark thumbnail has going for it.
      const glow = ctx.createRadialGradient(260, 180, 40, 260, 180, 900);
      glow.addColorStop(
        0,
        skin.ink === "#FFFFFF" ? "rgba(255,255,255,0.14)" : "rgba(255,255,255,0.55)",
      );
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, W, H);

      const loaded = (
        await Promise.all(flags.filter(Boolean).slice(0, 9).map(loadFlag))
      ).filter((i): i is HTMLImageElement => i !== null);

      if (loaded.length > 0) {
        const cols = loaded.length <= 4 ? 2 : 3;
        const rows = Math.ceil(loaded.length / cols);
        const cw = 168;
        const ch = 126;
        const gap = 16;
        const originX = W - (cols * cw + (cols - 1) * gap) - 64;
        const originY = (H - (rows * ch + (rows - 1) * gap)) / 2;

        loaded.forEach((img, i) => {
          const x = originX + (i % cols) * (cw + gap);
          const y = originY + Math.floor(i / cols) * (ch + gap);
          ctx.save();
          ctx.translate(x + cw / 2, y + ch / 2);
          ctx.rotate((((i % 2 === 0 ? -1 : 1) * 2.5) * Math.PI) / 180);
          ctx.shadowColor = "rgba(0,0,0,0.35)";
          ctx.shadowBlur = 22;
          ctx.shadowOffsetY = 8;
          ctx.fillStyle = "#fff";
          roundRect(ctx, -cw / 2 - 5, -ch / 2 - 5, cw + 10, ch + 10, 10);
          ctx.fill();
          ctx.shadowColor = "transparent";
          ctx.save();
          roundRect(ctx, -cw / 2, -ch / 2, cw, ch, 6);
          ctx.clip();
          ctx.drawImage(img, -cw / 2, -ch / 2, cw, ch);
          ctx.restore();
          ctx.restore();
        });
        column = 560;
      }
    }

    // ---- Headline ---------------------------------------------------------
    //
    // Wrapped into a column of known width rather than shrunk until one long
    // line happens to fit. The shrinking version ran the headline straight
    // through the picture: it trusted a single measurement, and a measurement
    // that comes back wrong has nothing to correct it.
    const left = 64;
    const paragraphs = lines.split("\n").map((l) => l.trim()).filter(Boolean);

    const wrapAt = (size: number): string[] => {
      ctx.font = `700 ${size}px ArchivoExpanded, system-ui, sans-serif`;
      const out: string[] = [];
      for (const paragraph of paragraphs) {
        let line = "";
        for (const word of paragraph.split(/\s+/)) {
          const candidate = line ? `${line} ${word}` : word;
          if (line && ctx.measureText(candidate).width > column) {
            out.push(line);
            line = word;
          } else {
            line = candidate;
          }
        }
        if (line) out.push(line);
      }
      return out;
    };

    let size = 104;
    let text = wrapAt(size);
    const maxBlock = textHeight - 80;
    while (
      size > 28 &&
      (text.length > 4 ||
        text.length * size * 1.16 > maxBlock ||
        Math.max(...text.map((l) => ctx.measureText(l).width), 0) > column)
    ) {
      size -= 2;
      text = wrapAt(size);
    }

    const lineHeight = size * 1.16;
    let y = textTop + (textHeight - text.length * lineHeight) / 2 + size * 0.8;
    // White ink is for text that actually lies on the photograph, which is only
    // the "full" layout. In the other two the words sit on the flat colour
    // beside or below the picture, and white on pale turquoise is a headline
    // held up by its outline alone.
    const overPhoto = Boolean(photo) && layout === "full";
    const ink = overPhoto ? "#FFFFFF" : skin.ink;

    text.forEach((line, i) => {
      ctx.font = `700 ${size}px ArchivoExpanded, system-ui, sans-serif`;
      const w = ctx.measureText(line).width;

      const highlighted = i === marked;
      if (highlighted) {
        ctx.fillStyle = skin.mark;
        ctx.fillRect(left - 10, y - size * 0.78, w + 20, size * 1.02);
      }

      // Every highlighter in the palette is a bright colour, so the line lying
      // on one is dark whatever the rest of the headline does. White on yellow
      // is the one combination this format must never produce.
      const lineInk = highlighted ? "#101418" : ink;

      if (outline) {
        // Drawn under the fill, not around it: a stroke on top eats into the
        // letterforms and turns bold type into mush at thumbnail size.
        ctx.lineJoin = "round";
        // Opposite the ink, always. Tied to the background instead, a white
        // headline on the black palette got a white outline and the letters
        // ran together into one bright blob.
        ctx.strokeStyle =
          lineInk === "#FFFFFF" ? "rgba(0,0,0,0.85)" : "rgba(255,255,255,0.9)";
        ctx.lineWidth = Math.max(6, size * 0.12);
        ctx.strokeText(line, left, y);
      }

      ctx.fillStyle = lineInk;
      ctx.fillText(line, left, y);
      y += lineHeight;
    });

    if (arrow) drawArrow(ctx, skin.mark);

    setReady(true);
  }, [flags, lines, skinIndex, marked, layout, arrow, outline, imageUrl]);

  useEffect(() => {
    void draw();
  }, [draw]);

  const download = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${slug || "thumbnail"}.jpg`;
        a.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      },
      "image/jpeg",
      0.92,
    );
  }, [slug]);

  const field: React.CSSProperties = {
    width: "100%",
    padding: "9px 10px",
    border: "1px solid var(--grid)",
    background: "#fff",
    fontSize: 13,
  };

  return (
    <Panel
      step={step}
      title="Thumbnail"
      right={
        <span className="mono" style={{ fontSize: 11, color: "#5b6672" }}>
          1280×720
        </span>
      }
    >
      <canvas
        ref={canvasRef}
        width={W}
        height={H}
        style={{
          width: "100%",
          height: "auto",
          border: "1px solid var(--grid)",
          display: "block",
        }}
      />

      <div style={{ height: 10 }} />
      <textarea
        value={lines}
        onChange={(e) => set({ lines: e.target.value })}
        aria-label="Thumbnail-Text"
        rows={3}
        style={{ ...field, lineHeight: 1.5, resize: "vertical" }}
      />
      <div className="mono" style={{ fontSize: 11, color: "#5b6672", marginTop: 4 }}>
        Eine Zeile pro Umbruch. Die Schrift schrumpft und bricht um, bis sie passt.
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <select
          value={skinIndex}
          onChange={(e) => set({ skin: Number(e.target.value) })}
          aria-label="Farbe"
          style={{ ...field, flex: 1 }}
        >
          {SKINS.map((s, i) => (
            <option key={s.name} value={i}>
              {s.name}
            </option>
          ))}
        </select>
        <select
          value={marked}
          onChange={(e) => set({ marked: Number(e.target.value) })}
          aria-label="Hervorgehobene Zeile"
          style={{ ...field, flex: 1 }}
        >
          <option value={-1}>ohne Markierung</option>
          {[0, 1, 2, 3].map((i) => (
            <option key={i} value={i}>
              Zeile {i + 1} markiert
            </option>
          ))}
        </select>
      </div>

      <div style={{ height: 8 }} />
      <select
        value={layout}
        onChange={(e) => set({ layout: e.target.value as Layout })}
        aria-label="Anordnung"
        style={field}
      >
        {LAYOUTS.map((l) => (
          <option key={l.id} value={l.id}>
            {l.label}
          </option>
        ))}
      </select>

      <div style={{ display: "flex", gap: 14, marginTop: 10, fontSize: 12 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={outline}
            onChange={(e) => set({ outline: e.target.checked })}
          />
          Textkontur
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={arrow}
            onChange={(e) => set({ arrow: e.target.checked })}
          />
          Pfeil
        </label>
      </div>

      {/* ---- The picture ---- */}
      <div
        style={{
          marginTop: 14,
          paddingTop: 12,
          borderTop: "1px solid var(--grid)",
        }}
      >
        <div className="mono" style={{ fontSize: 11, color: "#5b6672", marginBottom: 6 }}>
          Hintergrundbild {imageUrl ? "— erzeugt" : "— keins, Flaggen werden gezeigt"}
        </div>
        <textarea
          value={imagePrompt}
          onChange={(e) => set({ imagePrompt: e.target.value })}
          aria-label="Bildbeschreibung"
          rows={2}
          style={{ ...field, lineHeight: 1.45, resize: "vertical" }}
        />
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <Button onClick={() => void generate()} disabled={busy}>
            {busy ? "Bild wird erzeugt…" : imageUrl ? "Neues Bild" : "Bild erzeugen"}
          </Button>
          {imageUrl ? (
            <Button variant="ghost" onClick={() => set({ imageUrl: undefined })}>
              Entfernen
            </Button>
          ) : null}
        </div>
        {error ? <Note tone="alert">{error}</Note> : null}
        <Note tone="info">
          Kein Text im Bild — der wird hier darübergezeichnet. Bildmodelle
          schreiben deutsche Wörter bis heute unzuverlässig.
        </Note>
      </div>

      <div style={{ height: 12 }} />
      <Button onClick={download} disabled={!ready}>
        ↓ Thumbnail herunterladen
      </Button>
    </Panel>
  );
};
