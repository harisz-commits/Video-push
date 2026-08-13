import React from "react";
import { AbsoluteFill, interpolate, spring, staticFile } from "remotion";
import type { QuizSlot } from "../../lib/quiz";
import { LEVELS, MUTED, RIGHT, WRONG } from "./levels";

const LETTERS = ["A", "B", "C"] as const;

/**
 * One question, from slide-in to reveal.
 *
 * The whole slot is driven by a single frame counter and four boundaries, so
 * there is no state and no possibility of the picture disagreeing with the
 * clock. Which phase we are in is a comparison, not a variable.
 */
export const QuestionSlot: React.FC<{
  slot: QuizSlot;
  frame: number;
  fps: number;
  showAnswers: boolean;
}> = ({ slot, frame, fps, showAnswers }) => {
  const skin = LEVELS[slot.question.level];
  const { enterFrames, thinkFrames, revealFrames } = slot;

  const local = frame;
  const thinkFrom = enterFrames;
  const revealFrom = thinkFrom + thinkFrames;
  const revealed = local >= revealFrom;

  // Slide-in on a spring; the question arrives rather than appears.
  const entry = spring({
    frame: local,
    fps,
    config: { damping: 200, mass: 0.5 },
    durationInFrames: enterFrames,
  });

  const timerProgress = interpolate(
    local,
    [thinkFrom, revealFrom],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  return (
    <AbsoluteFill
      style={{
        alignItems: "center",
        justifyContent: "center",
        padding: "0 120px",
        opacity: entry,
        transform: `translateY(${interpolate(entry, [0, 1], [70, 0])}px)`,
      }}
    >
      <div style={{ width: "100%", maxWidth: 1400 }}>
        {/*
          Which question this is — and nothing about how hard it is.
          The difficulty is in the colour and in the tempo of the music, where
          a viewer takes it in without reading it. Written out as "EASY" it
          becomes an English word nobody asked for, and a promise the video
          cannot keep to whoever gets that question wrong.
        */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            marginBottom: 26,
          }}
        >
          <Pill text={`FRAGE ${slot.index + 1}`} color={skin.ink} faint />
        </div>

        {slot.question.flag ? (
          <Flag
            code={slot.question.flag}
            frame={local}
            big={!showAnswers}
          />
        ) : null}

        <h1
          style={{
            fontFamily: "var(--display, Inter, system-ui, sans-serif)",
            fontSize: slot.question.prompt.length > 60 ? 62 : 76,
            lineHeight: 1.1,
            textAlign: "center",
            color: skin.ink,
            margin: "0 0 34px",
            fontWeight: 800,
            letterSpacing: "-0.02em",
            textShadow: "0 6px 30px rgba(0,0,0,0.45)",
          }}
        >
          {slot.question.prompt}
        </h1>

        <TimerBar progress={timerProgress} skin={skin} done={revealed} />

        {showAnswers ? (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: 22,
              marginTop: 34,
            }}
          >
            {slot.question.answers.map((answer, i) => (
              <AnswerBox
                key={i}
                letter={LETTERS[i]}
                text={answer}
                // Answers land one after another, so even the entry is three
                // events instead of one.
                appear={spring({
                  frame: local - i * 3,
                  fps,
                  config: { damping: 200, mass: 0.5 },
                  durationInFrames: enterFrames,
                })}
                state={
                  !revealed
                    ? "waiting"
                    : i === slot.question.correctIndex
                      ? "right"
                      : "wrong"
                }
                revealFrame={local - revealFrom}
                revealFrames={revealFrames}
                fps={fps}
                accent={skin.accent}
                ink={skin.ink}
              />
            ))}
          </div>
        ) : (
          <Solution
            text={slot.question.answers[slot.question.correctIndex]}
            revealed={revealed}
            revealFrame={local - revealFrom}
            revealFrames={revealFrames}
            fps={fps}
          />
        )}
      </div>
    </AbsoluteFill>
  );
};

const Pill: React.FC<{ text: string; color: string; faint?: boolean }> = ({
  text,
  color,
  faint,
}) => (
  <span
    style={{
      fontFamily: "var(--mono, ui-monospace, monospace)",
      fontSize: 20,
      letterSpacing: "0.18em",
      color,
      opacity: faint ? 0.6 : 1,
      border: `2px solid ${color}`,
      borderRadius: 999,
      padding: "6px 18px",
      fontWeight: 700,
    }}
  >
    {text}
  </span>
);

/**
 * The flag, as a local file.
 *
 * Nothing is fetched at render time: the sandbox has no reason to reach the
 * network mid-render, and a quiz that fails because an image host was slow
 * would be the stupidest possible way to lose a video.
 */
const Flag: React.FC<{ code: string; frame: number; big?: boolean }> = ({
  code,
  frame,
  big,
}) => (
  <div style={{ display: "flex", justifyContent: "center", marginBottom: 30 }}>
    <img
      src={staticFile(`flags/${code}.svg`)}
      alt=""
      style={{
        // Without the three boxes underneath there is room, and the flag is
        // the question — so it takes the space rather than leaving it empty.
        width: big ? 560 : 420,
        height: big ? 420 : 315,
        objectFit: "cover",
        borderRadius: 18,
        border: "6px solid rgba(255,255,255,0.92)",
        boxShadow: "0 24px 60px rgba(0,0,0,0.5)",
        // A slow drift, because a flag held still for five seconds is the
        // exact standstill this format is supposed to avoid.
        transform: `scale(${1 + Math.sin(frame / 40) * 0.012})`,
      }}
    />
  </div>
);

const TimerBar: React.FC<{
  progress: number;
  skin: (typeof LEVELS)[keyof typeof LEVELS];
  done: boolean;
}> = ({ progress, skin, done }) => (
  <div
    style={{
      height: 22,
      borderRadius: 999,
      background: "rgba(0,0,0,0.38)",
      overflow: "hidden",
      border: "2px solid rgba(255,255,255,0.18)",
    }}
  >
    <div
      style={{
        height: "100%",
        width: `${Math.max(0, progress) * 100}%`,
        borderRadius: 999,
        // Turns red as it runs out — urgency without a number to read.
        background: done
          ? "transparent"
          : progress < 0.25
            ? WRONG
            : skin.accent,
        transition: "none",
      }}
    />
  </div>
);

const AnswerBox: React.FC<{
  letter: string;
  text: string;
  appear: number;
  state: "waiting" | "right" | "wrong";
  revealFrame: number;
  revealFrames: number;
  fps: number;
  accent: string;
  ink: string;
}> = ({ letter, text, appear, state, revealFrame, revealFrames, fps, accent, ink }) => {
  // The right answer jumps; the wrong ones sink. One spring, opposite signs.
  const pop =
    state === "waiting"
      ? 0
      : spring({
          frame: revealFrame,
          fps,
          config: { damping: 12, mass: 0.6 },
          durationInFrames: Math.min(revealFrames, 20),
        });

  const border =
    state === "waiting" ? "rgba(255,255,255,0.22)" : state === "right" ? RIGHT : MUTED;
  const background =
    state === "right"
      ? `rgba(31,216,122,${0.14 + pop * 0.16})`
      : state === "wrong"
        ? "rgba(0,0,0,0.34)"
        : "rgba(0,0,0,0.28)";

  return (
    <div
      style={{
        opacity: appear * (state === "wrong" ? 1 - pop * 0.45 : 1),
        transform: `translateY(${interpolate(appear, [0, 1], [40, 0])}px) scale(${
          state === "right" ? 1 + pop * 0.06 : state === "wrong" ? 1 - pop * 0.04 : 1
        })`,
        border: `4px solid ${border}`,
        borderRadius: 20,
        background,
        padding: "26px 20px",
        display: "flex",
        alignItems: "center",
        gap: 16,
        minHeight: 110,
        boxShadow:
          state === "right"
            ? `0 0 ${40 * pop}px rgba(31,216,122,${0.55 * pop})`
            : "0 10px 30px rgba(0,0,0,0.35)",
      }}
    >
      <span
        style={{
          fontFamily: "var(--mono, ui-monospace, monospace)",
          fontSize: 30,
          fontWeight: 800,
          color: state === "waiting" ? accent : border,
          width: 46,
          flexShrink: 0,
        }}
      >
        {state === "waiting" ? letter : state === "right" ? "✔" : "✕"}
      </span>
      <span
        style={{
          fontFamily: "var(--display, Inter, system-ui, sans-serif)",
          fontSize: text.length > 22 ? 30 : 38,
          fontWeight: 700,
          color: state === "wrong" ? MUTED : ink,
          lineHeight: 1.15,
          textDecoration: state === "wrong" ? "line-through" : "none",
        }}
      >
        {text}
      </span>
    </div>
  );
};

/**
 * The answer, when there were no options to tick.
 *
 * Held empty while the clock runs — deliberately, because the empty space is
 * what makes it a recall test rather than a reading test. Then the answer
 * arrives in it, large enough to be the only thing on screen.
 */
const Solution: React.FC<{
  text: string;
  revealed: boolean;
  revealFrame: number;
  revealFrames: number;
  fps: number;
}> = ({ text, revealed, revealFrame, revealFrames, fps }) => {
  const pop = revealed
    ? spring({
        frame: revealFrame,
        fps,
        config: { damping: 13, mass: 0.6 },
        durationInFrames: Math.min(revealFrames, 22),
      })
    : 0;

  return (
    <div
      style={{
        marginTop: 40,
        minHeight: 132,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {revealed ? (
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 22,
            border: `5px solid ${RIGHT}`,
            borderRadius: 22,
            background: `rgba(31,216,122,${0.12 + pop * 0.16})`,
            padding: "24px 54px",
            transform: `scale(${0.9 + pop * 0.1})`,
            opacity: pop,
            boxShadow: `0 0 ${52 * pop}px rgba(31,216,122,${0.5 * pop})`,
          }}
        >
          <span
            style={{
              fontFamily: "var(--mono, ui-monospace, monospace)",
              fontSize: 46,
              fontWeight: 800,
              color: RIGHT,
            }}
          >
            ✔
          </span>
          <span
            style={{
              fontFamily: "var(--display, Inter, system-ui, sans-serif)",
              fontSize: text.length > 20 ? 58 : 72,
              fontWeight: 800,
              color: "#FFFFFF",
              letterSpacing: "-0.02em",
            }}
          >
            {text}
          </span>
        </div>
      ) : null}
    </div>
  );
};
