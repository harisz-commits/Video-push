"use client";

import React, { useEffect, useState } from "react";
import type { Format } from "../lib/constants";
import type { QuizProject } from "../lib/quiz";
import type { VideoProject } from "../lib/schema";
import { FormatSwitch } from "./FormatSwitch";
import { QuizStudio } from "./QuizStudio";
import { Studio } from "./Studio";
import { VideoStudio } from "./VideoStudio";
import type { StoryProject } from "../lib/story";

const FORMAT_KEY = "infographics-studio.format";

/**
 * The frame around both studios.
 *
 * It owns exactly one thing — which format is open — and hands the rest to
 * whichever studio that is. Keeping the switch here rather than inside either
 * studio means neither has to know the other exists, and the header stays the
 * one part of the screen that is the same in both modes.
 */
export const StudioShell: React.FC<{
  seed: VideoProject;
  quizSeed: QuizProject;
  storySeed: StoryProject;
}> = ({ seed, quizSeed, storySeed }) => {
  const [format, setFormat] = useState<Format>("infographics");

  // Restored after mount rather than during render: the server has no
  // localStorage, and reading it while rendering would make the first paint
  // disagree with the markup that was sent.
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(FORMAT_KEY);
      if (stored === "quiz" || stored === "infographics" || stored === "video") {
        setFormat(stored);
      }
    } catch {
      // Defaulting to infographics is a fine answer.
    }
  }, []);

  const change = (next: Format) => {
    setFormat(next);
    try {
      window.localStorage.setItem(FORMAT_KEY, next);
    } catch {
      // The switch still works for this session.
    }
  };

  return (
    <div className="studio">
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          padding: "12px 20px",
          borderBottom: "1px solid var(--grid)",
        }}
      >
        <span className="display" style={{ fontSize: 15 }}>
          Video Studio
        </span>
        <FormatSwitch value={format} onChange={change} />
        <span className="mono" style={{ fontSize: 11, color: "#5b6672" }}>
          {format === "quiz"
            ? "Zeiten aus der Uhr — feste Bedenkzeit pro Frage"
            : format === "video"
              ? "Zeiten aus der Stimme — Bildwechsel folgen dem eigenen Schnitt"
              : "Zeiten aus der Stimme — Szenen folgen den Timestamps"}
        </span>
      </header>

      {format === "quiz" ? (
        <QuizStudio seed={quizSeed} />
      ) : format === "video" ? (
        <VideoStudio seed={storySeed} />
      ) : (
        <Studio seed={seed} />
      )}
    </div>
  );
};
