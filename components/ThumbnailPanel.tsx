"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Button, Note, Panel } from "./ui";

/**
 * The thumbnail, drawn in the browser.
 *
 * Deliberately not rendered on the server. A thumbnail is one still frame, and
 * putting it through the render path would mean booting a sandbox, restoring a
 * snapshot and paying for a virtual machine — forty seconds and real money to
 * produce a single JPEG, every time a word is changed. On a canvas it is
 * instant, free, and can be adjusted until it looks right.
 *
 * It is also not generated: the picture is the quiz's own flags and its own
 * title, which is both cheaper and more honest than an image model's idea of
 * what a flag looks like.
 */

const W = 1280;
const H = 720;

type Skin = { name: string; bg: string; ink: string; mark: string };

/**
 * Bright, flat, and high-contrast — a thumbnail is looked at for a fifth of a
 * second at the size of a postage stamp, so subtlety is wasted on it.
 */
const SKINS: Skin[] = [
  { name: "Türkis", bg: "#A8F0EA", ink: "#101418", mark: "#F5A8E0" },
  { name: "Gelb", bg: "#F2ED64", ink: "#101418", mark: "#B9A6FF" },
  { name: "Koralle", bg: "#FFB3A7", ink: "#101418", mark: "#9BE8FF" },
  { name: "Limette", bg: "#C6F26A", ink: "#101418", mark: "#FFB3E6" },
];

/**
 * Draw an SVG file onto a canvas.
 *
 * Fetched and re-serialised with explicit dimensions rather than pointed at
 * directly: these flags carry only a viewBox, and a browser handed an SVG with
 * no intrinsic size is entitled to draw nothing at all. Setting width and
 * height makes the result the same everywhere.
 */
async function loadFlag(code: string): Promise<HTMLImageElement | null> {
  try {
    const res = await fetch(`/flags/${code}.svg`);
    if (!res.ok) return null;
    const svg = (await res.text()).replace(
      "<svg",
      '<svg width="640" height="480"',
    );
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error(code));
      img.src = url;
    });
    URL.revokeObjectURL(url);
    return img;
  } catch {
    return null;
  }
}

/**
 * Break a title into thumbnail lines.
 *
 * Three words a line, upper case. A title is written to be read in a list; a
 * thumbnail headline is read in a glance, and the difference is mostly line
 * breaks.
 */
function headlineFrom(title: string): string {
  const words = title.toUpperCase().replace(/\s+/g, " ").trim().split(" ");
  const out: string[] = [];
  for (let i = 0; i < words.length; i += 3) {
    out.push(words.slice(i, i + 3).join(" "));
  }
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

export const ThumbnailPanel: React.FC<{
  step: string;
  /** Two-letter codes to show, in order. Anything missing is skipped. */
  flags: string[];
  /** Seeds the headline the first time. */
  defaultTitle: string;
  /** Used for the downloaded file name. */
  slug: string;
}> = ({ step, flags, defaultTitle, slug }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [lines, setLines] = useState<string>("");
  const [skinIndex, setSkinIndex] = useState(0);
  const [marked, setMarked] = useState(1);
  const [ready, setReady] = useState(false);

  // Seeded once, then left alone: re-seeding on every title change would
  // silently undo whatever the user had typed.
  useEffect(() => {
    setLines((current) =>
      current ? current : headlineFrom(defaultTitle),
    );
  }, [defaultTitle]);

  const draw = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const skin = SKINS[skinIndex] ?? SKINS[0];
    // Webfonts load after the first paint; drawing before they are ready gives
    // a thumbnail in a fallback face that looks nothing like the studio.
    await document.fonts.ready.catch(() => undefined);

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = skin.bg;
    ctx.fillRect(0, 0, W, H);

    // A soft light from the top left, so a flat colour does not read as a
    // screenshot of a colour.
    const glow = ctx.createRadialGradient(260, 180, 40, 260, 180, 900);
    glow.addColorStop(0, "rgba(255,255,255,0.55)");
    glow.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);

    // ---- Flags, right-hand side -------------------------------------------
    const codes = flags.filter(Boolean).slice(0, 9);
    const loaded = (await Promise.all(codes.map(loadFlag))).filter(
      (i): i is HTMLImageElement => i !== null,
    );

    if (loaded.length > 0) {
      const cols = loaded.length <= 4 ? 2 : 3;
      const rows = Math.ceil(loaded.length / cols);
      const cw = 168;
      const ch = 126;
      const gap = 16;
      const blockW = cols * cw + (cols - 1) * gap;
      const blockH = rows * ch + (rows - 1) * gap;
      const originX = W - blockW - 64;
      const originY = (H - blockH) / 2;

      loaded.forEach((img, i) => {
        const x = originX + (i % cols) * (cw + gap);
        const y = originY + Math.floor(i / cols) * (ch + gap);
        ctx.save();
        // A slight alternating tilt: a perfect grid reads as a table, a
        // scattered one as a pile of things worth looking at.
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
    }

    // ---- Headline, left-hand side -----------------------------------------
    //
    // Laid out by wrapping into a column whose width is fixed in advance,
    // rather than by shrinking one long line until it happens to fit. The
    // shrinking version put the headline straight through the flags: it
    // trusted a single measurement, and one measurement that comes back wrong
    // has nothing to correct it.
    const column = loaded.length > 0 ? 560 : W - 128;
    const left = 64;

    const paragraphs = lines
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);

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

    // Largest size at which the whole headline fits the column and the height.
    let size = 104;
    let text = wrapAt(size);
    while (
      size > 30 &&
      (text.length > 4 ||
        text.length * size * 1.16 > 560 ||
        Math.max(...text.map((l) => ctx.measureText(l).width), 0) > column)
    ) {
      size -= 2;
      text = wrapAt(size);
    }

    const lineHeight = size * 1.16;
    let y = (H - text.length * lineHeight) / 2 + size * 0.8;

    text.forEach((line, i) => {
      ctx.font = `700 ${size}px ArchivoExpanded, system-ui, sans-serif`;
      const w = ctx.measureText(line).width;

      if (i === marked) {
        ctx.fillStyle = skin.mark;
        // Behind the text and a touch taller than the letters, the way a
        // highlighter sits on paper.
        ctx.fillRect(left - 10, y - size * 0.78, w + 20, size * 1.02);
      }

      ctx.fillStyle = skin.ink;
      ctx.fillText(line, left, y);
      y += lineHeight;
    });

    setReady(true);
  }, [flags, lines, skinIndex, marked]);

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
        // Revoked on the next tick: revoking immediately can beat the click.
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      },
      // JPEG at high quality: a thumbnail of flat colour and text is a few
      // hundred kilobytes this way and several megabytes as a PNG, and the
      // upload limit is two.
      "image/jpeg",
      0.92,
    );
  }, [slug]);

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
        onChange={(e) => setLines(e.target.value)}
        aria-label="Thumbnail-Text"
        rows={3}
        placeholder={"KANNST DU\nALLE LÄNDER\nERRATEN?"}
        style={{
          width: "100%",
          padding: "10px 12px",
          border: "1px solid var(--grid)",
          background: "#fff",
          fontSize: 13,
          lineHeight: 1.5,
          resize: "vertical",
        }}
      />
      <div className="mono" style={{ fontSize: 11, color: "#5b6672", marginTop: 4 }}>
        Eine Zeile pro Zeilenumbruch. Die Schrift schrumpft, bis sie passt.
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <select
          value={skinIndex}
          onChange={(e) => setSkinIndex(Number(e.target.value))}
          aria-label="Farbe"
          style={{
            flex: 1,
            padding: "9px 10px",
            border: "1px solid var(--grid)",
            background: "#fff",
            fontSize: 13,
          }}
        >
          {SKINS.map((s, i) => (
            <option key={s.name} value={i}>
              {s.name}
            </option>
          ))}
        </select>
        <select
          value={marked}
          onChange={(e) => setMarked(Number(e.target.value))}
          aria-label="Hervorgehobene Zeile"
          style={{
            flex: 1,
            padding: "9px 10px",
            border: "1px solid var(--grid)",
            background: "#fff",
            fontSize: 13,
          }}
        >
          <option value={-1}>ohne Markierung</option>
          {[0, 1, 2, 3].map((i) => (
            <option key={i} value={i}>
              Zeile {i + 1} markiert
            </option>
          ))}
        </select>
      </div>

      <div style={{ height: 10 }} />
      <Button onClick={download} disabled={!ready}>
        ↓ Thumbnail herunterladen
      </Button>
      <Note tone="info">
        Wird im Browser gezeichnet — kostet nichts und ist sofort da. Die
        Flaggen sind die aus diesem Quiz.
      </Note>
    </Panel>
  );
};
