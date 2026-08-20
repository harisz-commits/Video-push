"use client";

import React, { useCallback, useEffect, useState } from "react";
import { getJson, postJson } from "./api";
import { Button, Note, Panel } from "./ui";

/**
 * What the studio owns, and can listen to.
 *
 * The sounds are the reason this exists. A picture belongs to one look and is
 * reused only by films that share it; a sound belongs to nothing at all — wind
 * is wind — so the same handful of beds should carry every film this channel
 * ever makes. That only works if you can hear them, see which ones keep coming
 * back, and throw out the ones that came back wrong.
 *
 * Loaded on demand rather than with the page: nobody needs an inventory to
 * write a script, and the list grows without limit.
 */

type Sound = {
  key: string;
  name: string;
  kind: string;
  description: string;
  seconds: number | null;
  url: string;
  uses: number;
};

type Image = {
  key: string;
  name: string;
  style: string;
  url: string;
  thumbUrl?: string;
  uses: number;
};

export const LibraryPanel: React.FC<{ step: string }> = ({ step }) => {
  const [open, setOpen] = useState(false);
  const [sounds, setSounds] = useState<Sound[]>([]);
  const [images, setImages] = useState<Image[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"sounds" | "images">("sounds");
  const [note, setNote] = useState<string | null>(null);
  const [recovering, setRecovering] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    const result = await getJson<{ sounds: Sound[]; images: Image[] }>(
      "/api/library",
    );
    if (result.ok) {
      setSounds(result.data.sounds ?? []);
      setImages(result.data.images ?? []);
    } else {
      setError(result.error);
    }
    setBusy(false);
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  /**
   * Put back what the index lost.
   *
   * Offered as a button rather than run automatically, because it writes to
   * the one document the whole library rests on. It cannot cost anything: it
   * adds entries for files that already exist and never draws, generates or
   * deletes.
   */
  async function recover() {
    setRecovering(true);
    setNote(null);
    setError(null);
    const result = await postJson<{
      scanned: number;
      images: number;
      sounds: number;
      already: number;
      repaired?: { moved: number; projects: number };
      voices?: { restored: { project: string; seconds: number }[]; ambiguous: number };
    }>("/api/library", {});
    if (!result.ok) {
      setError(result.error);
      setRecovering(false);
      return;
    }
    const { images, sounds, already, scanned, repaired } = result.data;
    const parts: string[] = [];
    if (images + sounds > 0) {
      parts.push(
        `${images} Bilder und ${sounds} Klänge aus ${scanned} Videos zurückgeholt — bezahlt, im Speicher, nur nicht im Verzeichnis.`,
      );
    } else {
      parts.push(
        `${scanned} Videos durchgesehen, nichts fehlte. Alle ${already} Einträge waren schon da.`,
      );
    }
    const voices = result.data.voices;
    if (voices && voices.restored.length > 0) {
      parts.push(
        `${voices.restored.length} Aufnahme(n) wieder zugeordnet: ${voices.restored
          .map((v) => `„${v.project}“ (${v.seconds} s)`)
          .join(", ")}.`,
      );
    }
    if (voices && voices.ambiguous > 0) {
      parts.push(
        `${voices.ambiguous} Video(s) hätten mehrere passende Aufnahmen — die wurden nicht angefasst, um nicht die falsche einzusetzen.`,
      );
    }
    if (repaired && repaired.moved > 0) {
      parts.push(
        `${repaired.moved} Klänge umbenannt, damit sie beim Rendern nicht mehr stumm bleiben (${repaired.projects} Videos angepasst). Diese Videos musst du neu rendern.`,
      );
    }
    setNote(parts.join(" "));
    setRecovering(false);
    await load();
  }

  async function forget(key: string, label: string) {
    if (!window.confirm(`„${label}“ endgültig löschen? Die Datei geht mit.`)) {
      return;
    }
    const response = await fetch(`/api/library?key=${encodeURIComponent(key)}`, {
      method: "DELETE",
    });
    if (!response.ok) {
      setError("Löschen fehlgeschlagen.");
      return;
    }
    setSounds((list) => list.filter((s) => s.key !== key));
    setImages((list) => list.filter((i) => i.key !== key));
  }

  return (
    <Panel
      step={step}
      title="Bibliothek"
      right={
        <span className="mono" style={{ fontSize: 11, color: "#5b6672" }}>
          {open ? `${sounds.length} Klänge · ${images.length} Bilder` : "zu"}
        </span>
      }
    >
      <Button variant="ghost" onClick={() => setOpen((v) => !v)}>
        {open ? "Zuklappen" : "Bibliothek öffnen"}
      </Button>

      {!open ? (
        <Note tone="info">
          Alles, was je erzeugt wurde. Klänge werden automatisch
          wiederverwendet — hier kannst du sie anhören und aussortieren.
        </Note>
      ) : null}

      {open ? (
        <>
          <div style={{ display: "flex", gap: 6, margin: "10px 0" }}>
            <Button
              variant={tab === "sounds" ? undefined : "ghost"}
              onClick={() => setTab("sounds")}
            >
              Klänge ({sounds.length})
            </Button>
            <Button
              variant={tab === "images" ? undefined : "ghost"}
              onClick={() => setTab("images")}
            >
              Bilder ({images.length})
            </Button>
          </div>

          <Button variant="ghost" onClick={() => void recover()} disabled={recovering}>
            {recovering ? "wird durchsucht…" : "Verlorene Einträge zurückholen"}
          </Button>

          {error ? <Note tone="alert">{error}</Note> : null}
          {note ? <Note tone="info">{note}</Note> : null}
          {busy ? <Note tone="info">wird geladen…</Note> : null}

          {tab === "sounds" ? (
            <div style={{ maxHeight: 340, overflowY: "auto" }}>
              {sounds.length === 0 && !busy ? (
                <Note tone="info">
                  Noch keine Klänge. Sie entstehen beim ersten „Geräusche
                  erzeugen“ und bleiben dann für alle weiteren Videos da.
                </Note>
              ) : null}
              {sounds.map((s) => (
                <div
                  key={s.key}
                  style={{
                    padding: "7px 0",
                    borderBottom: "1px solid var(--grid)",
                    fontSize: 12,
                  }}
                >
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <span
                      className="mono"
                      style={{ fontSize: 10, color: "#5b6672", minWidth: 58 }}
                    >
                      {s.kind === "ambience" ? "Teppich" : "Akzent"}
                    </span>
                    <span style={{ flex: 1 }}>{s.name}</span>
                    <span className="mono" style={{ fontSize: 10, color: "#5b6672" }}>
                      {s.uses}×{s.seconds ? ` · ${s.seconds}s` : ""}
                    </span>
                    <Button variant="ghost" onClick={() => void forget(s.key, s.name)}>
                      ✕
                    </Button>
                  </div>
                  <audio
                    src={s.url}
                    controls
                    preload="none"
                    style={{ height: 26, width: "100%", marginTop: 4 }}
                  />
                  <div
                    className="mono"
                    style={{ fontSize: 10, color: "#5b6672", marginTop: 3 }}
                  >
                    {s.description}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ maxHeight: 340, overflowY: "auto" }}>
              {images.map((i) => (
                <div
                  key={`${i.key}-${i.style}`}
                  style={{
                    display: "flex",
                    gap: 8,
                    alignItems: "center",
                    padding: "5px 0",
                    borderBottom: "1px solid var(--grid)",
                    fontSize: 12,
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={i.thumbUrl ?? i.url}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    style={{ width: 48, height: 27, objectFit: "cover" }}
                  />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    {i.name}
                    <span
                      className="mono"
                      style={{ fontSize: 10, color: "#5b6672", display: "block" }}
                    >
                      {i.style}
                    </span>
                  </span>
                  <span className="mono" style={{ fontSize: 10, color: "#5b6672" }}>
                    {i.uses}×
                  </span>
                  <Button variant="ghost" onClick={() => void forget(i.key, i.name)}>
                    ✕
                  </Button>
                </div>
              ))}
            </div>
          )}
        </>
      ) : null}
    </Panel>
  );
};
