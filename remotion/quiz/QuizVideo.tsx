"use client";

import React from "react";
import {
  AbsoluteFill,
  Audio,
  interpolate,
  Sequence,
  spring,
  useCurrentFrame,
} from "remotion";
import { resolveQuizTiming, type QuizProject } from "../../lib/quiz";
import { ensureFonts } from "../shared/fonts";
import { LEVELS } from "./levels";
import { QuestionSlot } from "./QuestionSlot";
import { QuizSound } from "./QuizSound";
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
  //
  // Before the first question and after the last there is no question to ask,
  // so the intro borrows the first one's colour and the end card keeps the last
  // one's. Falling back to slot zero everywhere meant the outro of a video that
  // had just clawed its way to red opened in the green it started in.
  const activeSlot =
    timing.slots.find(
      (s) => frame >= s.from && frame < s.from + s.durationInFrames,
    ) ??
    (frame >= timing.outroFrom
      ? timing.slots[timing.slots.length - 1]
      : timing.slots[0]);
  const skin = LEVELS[activeSlot?.question.level ?? "easy"];

  return (
    <AbsoluteFill style={{ backgroundColor: skin.deep }}>
      <Sunburst frame={frame} skin={skin} />

      {/*
        The soundtrack is not optional garnish here. The tick IS the timer, so
        a quiz rendered without it would be missing the mechanic, not the mood.
      */}
      <QuizSound timing={timing} fps={project.fps} />

      {/* A voiceover, when there is one, sits on top of all of it. */}
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
          <Outro
            text={project.outro}
            frames={timing.outroFrames}
            fps={project.fps}
          />
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

/**
 * The end card.
 *
 * Was one line held for three seconds, which is enough for a sign-off and not
 * enough for an ask. The ask is the entire point of the last five seconds of
 * this format: a viewer who watched thirty questions is as warm as they will
 * ever be, and the video has to say what it wants from them before they scroll.
 *
 * So it arrives in two beats — thanks first, then the request — because two
 * things landing one after another are read, while two things appearing at once
 * are skipped.
 */
const Outro: React.FC<{ text: string; frames: number; fps: number }> = ({
  text,
  frames,
  fps,
}) => {
  const frame = useCurrentFrame();
  const t = frame / Math.max(1, frames);

  const thanks = spring({
    frame,
    fps,
    config: { damping: 200, mass: 0.6 },
    durationInFrames: Math.round(fps * 0.5),
  });
  const ask = spring({
    frame: frame - Math.round(fps * 0.55),
    fps,
    config: { damping: 14, mass: 0.7 },
    durationInFrames: Math.round(fps * 0.7),
  });

  // The button breathes rather than sits. A still call to action reads as part
  // of the background; a moving one reads as something to do.
  const pulse = 1 + Math.sin(frame / 6) * 0.02 * Math.min(1, ask);

  return (
    <AbsoluteFill
      style={{
        alignItems: "center",
        justifyContent: "center",
        padding: "0 140px",
        textAlign: "center",
        opacity: interpolate(t, [0, 0.08, 0.94, 1], [0, 1, 1, 0]),
      }}
    >
      <div>
        <div
          style={{
            fontFamily: "var(--display, Inter, system-ui, sans-serif)",
            fontSize: 76,
            fontWeight: 900,
            color: "#FFFFFF",
            lineHeight: 1.12,
            letterSpacing: "-0.02em",
            textShadow: "0 10px 44px rgba(0,0,0,0.6)",
            opacity: thanks,
            transform: `translateY(${interpolate(thanks, [0, 1], [40, 0])}px)`,
          }}
        >
          {text}
        </div>

        <div
          style={{
            marginTop: 44,
            display: "flex",
            justifyContent: "center",
            opacity: ask,
            transform: `translateY(${interpolate(ask, [0, 1], [50, 0])}px) scale(${pulse})`,
          }}
        >
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 18,
              background: "#FF0033",
              color: "#fff",
              borderRadius: 999,
              padding: "22px 52px",
              fontFamily: "var(--display, Inter, system-ui, sans-serif)",
              fontSize: 46,
              fontWeight: 900,
              letterSpacing: "0.02em",
              boxShadow: "0 20px 60px rgba(255,0,51,0.45)",
            }}
          >
            <span
              aria-hidden
              style={{
                display: "inline-block",
                width: 0,
                height: 0,
                borderTop: "16px solid transparent",
                borderBottom: "16px solid transparent",
                borderLeft: "26px solid #fff",
              }}
            />
            ABONNIEREN
          </span>
        </div>
      </div>
    </AbsoluteFill>
  );
};
