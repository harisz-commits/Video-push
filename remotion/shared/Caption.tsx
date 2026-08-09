import React from "react";
import { C, SAFE, TYPE } from "./Tokens";
import { useWordTiming } from "./useWordTiming";

/** How many words of context sit either side of the active word. */
const WINDOW = 4;

/**
 * Word-synchronous subtitle. The active word is wheat, its neighbours ink.
 * Driven entirely by the ElevenLabs timestamps — no manual cue sheet.
 */
export const Caption: React.FC<{ absoluteFrame: number }> = ({
  absoluteFrame,
}) => {
  const { words, activeIndex } = useWordTiming(absoluteFrame);

  if (activeIndex < 0 || words.length === 0) return null;

  const start = Math.max(0, activeIndex - WINDOW);
  const end = Math.min(words.length, activeIndex + WINDOW + 1);
  const slice = words.slice(start, end);

  return (
    <div
      style={{
        position: "absolute",
        left: SAFE,
        right: SAFE,
        bottom: SAFE - 24,
        display: "flex",
        justifyContent: "center",
        gap: 12,
        flexWrap: "wrap",
        ...TYPE.caption,
      }}
    >
      {slice.map((w, i) => {
        const isActive = start + i === activeIndex;
        return (
          <span
            key={`${start + i}-${w.word}`}
            style={{
              color: isActive ? C.wheat : C.ink,
              opacity: isActive ? 1 : 0.55,
            }}
          >
            {w.word}
          </span>
        );
      })}
    </div>
  );
};
