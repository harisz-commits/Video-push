import React, { useMemo } from "react";
import { useVideoConfig } from "remotion";
import { captionPages } from "../../lib/align";
import { C, SAFE, TYPE } from "./Tokens";
import { useWordTiming } from "./useWordTiming";

/**
 * Two lines that hold still while the highlight moves through them.
 *
 * The text is grouped into blocks ahead of time, each block covering as many
 * words as fit on two lines. A block stays put for as long as its words are
 * spoken, so the eye has something stable to read; only the colour of the
 * current word changes. The previous version re-centred a sliding window on
 * every word, which meant the entire line jumped several times a second.
 */
export const Caption: React.FC<{ absoluteFrame: number; accent: string }> = ({
  absoluteFrame,
  accent,
}) => {
  const { fps } = useVideoConfig();
  const { words, activeIndex } = useWordTiming(absoluteFrame);

  const pages = useMemo(() => captionPages(words), [words]);
  const seconds = absoluteFrame / fps;

  const page = useMemo(() => {
    if (pages.length === 0) return null;
    // The block being spoken; between blocks, keep showing the one just ended
    // so the screen does not blink empty during a breath.
    let candidate = pages[0];
    for (const p of pages) {
      if (p.start <= seconds) candidate = p;
      else break;
    }
    return seconds > candidate.end + 1.2 ? null : candidate;
  }, [pages, seconds]);

  if (!page) return null;

  const activeWord = activeIndex >= 0 ? words[activeIndex] : null;
  const lines = [
    page.words.slice(0, page.breakAt),
    page.words.slice(page.breakAt),
  ].filter((line) => line.length > 0);

  return (
    <div
      style={{
        position: "absolute",
        left: SAFE,
        right: SAFE,
        bottom: SAFE - 40,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 6,
        ...TYPE.caption,
      }}
    >
      {lines.map((line, lineIndex) => (
        <div
          key={lineIndex}
          style={{ display: "flex", gap: 11, justifyContent: "center" }}
        >
          {line.map((word) => {
            const isActive =
              activeWord !== null &&
              word.start === activeWord.start &&
              word.word === activeWord.word;
            return (
              <span
                key={`${word.start}-${word.word}`}
                style={{
                  color: isActive ? accent : C.ink,
                  opacity: isActive ? 1 : 0.62,
                }}
              >
                {word.word}
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
};
