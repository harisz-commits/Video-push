import { useMemo } from "react";
import { useVideoConfig } from "remotion";
import type { WordTiming } from "../../lib/align";
import { wordsFromAlignment } from "../../lib/align";
import { useProject } from "./ProjectContext";

export type { WordTiming };

/**
 * Which word is being spoken right now.
 *
 * Takes an ABSOLUTE frame — inside a <Sequence>, useCurrentFrame() is
 * scene-relative, so callers add the scene's own start frame first. Effects
 * that must land on a specific word (a counter starting exactly on
 * "vierzehneinhalb") read `activeIndex` rather than guessing a delay.
 */
export function useWordTiming(absoluteFrame: number) {
  const { project } = useProject();
  const { fps } = useVideoConfig();

  const words = useMemo<WordTiming[]>(
    () => (project.alignment ? wordsFromAlignment(project.alignment) : []),
    [project.alignment],
  );

  const seconds = absoluteFrame / fps;

  const activeIndex = useMemo(() => {
    if (words.length === 0) return -1;

    // Binary search for the last word that has already started.
    let lo = 0;
    let hi = words.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (words[mid].start <= seconds) {
        found = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    // Past the end of a word with no successor yet -> nothing is being spoken.
    if (found >= 0 && seconds > words[found].end + 0.4) return -1;
    return found;
  }, [words, seconds]);

  return {
    words,
    activeIndex,
    activeWord: activeIndex >= 0 ? words[activeIndex] : null,
    seconds,
  };
}
