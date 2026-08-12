"use client";

import React from "react";
import {
  AbsoluteFill,
  Audio,
  interpolate,
  Sequence,
  useCurrentFrame,
} from "remotion";
import { resolveQuizTiming, type QuizProject } from "../../lib/quiz";
import { ensureFonts } from "../shared/fonts";
import { LEVELS } from "./levels";
import { QuestionSlot } from "./QuestionSlot";
import { Sunburst } from "./Sunburst";

/**
 * The quiz format.
 *
 * Everything here is timed by the clock in lib/quiz.ts rather than by the
 * voice, which is what lets it hold a pace the infographics format keeps
 * missing: the longest a single picture stays put is one think phase, and even
 * that has a bar draining across it the whole time.
 */
export const QuizVideo: React.FC<{ project: QuizProject }> = ({ project }) => {
  ensureFonts();
  const timing = resolveQuizTiming(project);
  const frame = useCurrentFrame();

  // The background belongs to the video, not to a question: it has to survive
  // the wipe between two questions, or every cut would flash black.
  const activeSlot =
    timing.slots.find(
      (s) => frame >= s.from && frame < s.from + s.durationInFrames,
    ) ?? timing.slots[0];
  const skin = LEVELS[activeSlot?.question.level ?? "easy"];

  return (
    <AbsoluteFill style={{ backgroundColor: skin.deep }}>
      <Sunburst frame={frame} skin={skin} />

      {project.audioUrl ? <Audio src={project.audioUrl} /> : null}

      <Sequence durationInFrames={timing.introFrames} name="Intro">
        <Intro project={project} frames={timing.introFrames} />
      </Sequence>

      {timing.slots.map((slot) => (
        <Sequence
          key={slot.question.id}
          from={slot.from}
          durationInFrames={slot.durationInFrames}
          name={`${String(slot.index + 1).padStart(2, "0")} ${slot.question.level}`}
        >
          <SlotFrame slot={slot} fps={project.fps} />
        </Sequence>
      ))}

      {project.outro ? (
        <Sequence
          from={timing.outroFrom}
          durationInFrames={timing.outroFrames}
          name="Outro"
        >
          <Outro text={project.outro} frames={timing.outroFrames} />
        </Sequence>
      ) : null}
    </AbsoluteFill>
  );
};

/**
 * A question plus the wipe that ends it.
 *
 * The wipe is here rather than between sequences because it has to travel over
 * the outgoing question — a transition drawn between two sequences would have
 * nothing underneath it.
 */
const SlotFrame: React.FC<{ slot: ReturnType<typeof resolveQuizTiming>["slots"][number]; fps: number }> = ({
  slot,
  fps,
}) => {
  const frame = useCurrentFrame();
  const wipeFrom = slot.durationInFrames - slot.exitFrames;
  const wiping = frame >= wipeFrom;
  const skin = LEVELS[slot.question.level];

  return (
    <AbsoluteFill>
      <QuestionSlot slot={slot} frame={frame} fps={fps} />
      {wiping ? (
        <AbsoluteFill
          style={{
            background: skin.accent,
            transform: `translateX(${interpolate(
              frame,
              [wipeFrom, slot.durationInFrames],
              [-100, 0],
            )}%) skewX(-8deg)`,
          }}
        />
      ) : null}
    </AbsoluteFill>
  );
};

const Intro: React.FC<{ project: QuizProject; frames: number }> = ({
  project,
  frames,
}) => {
  const frame = useCurrentFrame();
  const t = frame / Math.max(1, frames);
  const skin = LEVELS.easy;

  return (
    <AbsoluteFill
      style={{
        alignItems: "center",
        justifyContent: "center",
        padding: "0 140px",
        textAlign: "center",
        opacity: interpolate(t, [0, 0.12, 0.86, 1], [0, 1, 1, 0]),
        transform: `scale(${interpolate(t, [0, 1], [0.94, 1.04])})`,
      }}
    >
      <div>
        <div
          style={{
            fontFamily: "var(--display, Inter, system-ui, sans-serif)",
            fontSize: 96,
            fontWeight: 900,
            letterSpacing: "-0.03em",
            color: skin.ink,
            lineHeight: 1.05,
            textShadow: "0 10px 44px rgba(0,0,0,0.55)",
          }}
        >
          {project.title}
        </div>
        <div
          style={{
            marginTop: 26,
            fontFamily: "var(--mono, ui-monospace, monospace)",
            fontSize: 30,
            letterSpacing: "0.16em",
            color: skin.accent,
            fontWeight: 700,
          }}
        >
          {project.questions.length} FRAGEN
        </div>
      </div>
    </AbsoluteFill>
  );
};

const Outro: React.FC<{ text: string; frames: number }> = ({ text, frames }) => {
  const frame = useCurrentFrame();
  const t = frame / Math.max(1, frames);
  return (
    <AbsoluteFill
      style={{
        alignItems: "center",
        justifyContent: "center",
        padding: "0 160px",
        textAlign: "center",
        opacity: interpolate(t, [0, 0.15, 0.85, 1], [0, 1, 1, 0]),
      }}
    >
      <div
        style={{
          fontFamily: "var(--display, Inter, system-ui, sans-serif)",
          fontSize: 68,
          fontWeight: 800,
          color: "#FFFFFF",
          lineHeight: 1.15,
          textShadow: "0 10px 44px rgba(0,0,0,0.55)",
        }}
      >
        {text}
      </div>
    </AbsoluteFill>
  );
};
