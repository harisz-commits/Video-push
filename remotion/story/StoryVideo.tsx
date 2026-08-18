import React from "react";
import {
  AbsoluteFill,
  Audio,
  Img,
  interpolate,
  Sequence,
  useCurrentFrame,
} from "remotion";
import {
  resolveStoryTiming,
  type ResolvedShot,
  type StoryProject,
} from "../../lib/story";

/**
 * The video format: one voice, many drawn pictures.
 *
 * Deliberately the simplest of the three compositions. The infographics format
 * animates data and the quiz animates a clock; here the picture IS the content,
 * so anything this layer adds competes with what the viewer is meant to be
 * looking at. What it does add is the two things a stream of stills cannot do
 * without: it never holds a picture perfectly still, and it never cuts hard
 * between two of them.
 *
 * Both are the difference between a film and a slideshow, and both are almost
 * free — which matters, because the alternative way to make a hundred stills
 * feel like a film is to draw three hundred of them.
 */

/** Frames of cross-fade between two pictures. */
const FADE = 9;

/** How far a picture travels while it is up, as a fraction of its size. */
const DRIFT = 0.06;

/**
 * The zoom a picture starts and ends at.
 *
 * Never one. A still rendered at exactly its natural size shows its edges the
 * moment it moves, so every picture is oversized and the movement happens
 * inside that margin.
 */
const BASE_SCALE = 1.08;
const TRAVEL = 0.07;

function transformFor(shot: ResolvedShot, progress: number): string {
  const eased = progress * progress * (3 - 2 * progress);

  switch (shot.motion) {
    case "out":
      return `scale(${BASE_SCALE + TRAVEL - eased * TRAVEL})`;
    case "left":
      return `scale(${BASE_SCALE + DRIFT}) translateX(${(0.5 - eased) * DRIFT * 100}%)`;
    case "right":
      return `scale(${BASE_SCALE + DRIFT}) translateX(${(eased - 0.5) * DRIFT * 100}%)`;
    case "up":
      return `scale(${BASE_SCALE + DRIFT}) translateY(${(0.5 - eased) * DRIFT * 100}%)`;
    case "down":
      return `scale(${BASE_SCALE + DRIFT}) translateY(${(eased - 0.5) * DRIFT * 100}%)`;
    case "in":
    default:
      return `scale(${BASE_SCALE + eased * TRAVEL})`;
  }
}

const Shot: React.FC<{ shot: ResolvedShot; first: boolean }> = ({
  shot,
  first,
}) => {
  const frame = useCurrentFrame();
  const progress = Math.min(
    1,
    Math.max(0, (frame - FADE) / Math.max(1, shot.durationInFrames)),
  );

  // The first picture has nothing to fade up from, so it simply starts.
  const opacity = first
    ? 1
    : interpolate(frame, [0, FADE], [0, 1], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      });

  if (!shot.url) return null;

  return (
    <AbsoluteFill style={{ opacity }}>
      <Img
        src={shot.url}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          transform: transformFor(shot, progress),
          // The transform is applied every frame, so the browser is told once
          // that this layer moves rather than working it out repeatedly.
          willChange: "transform",
        }}
      />
    </AbsoluteFill>
  );
};

export const StoryVideo: React.FC<{ project: StoryProject }> = ({ project }) => {
  const timing = resolveStoryTiming(project);

  return (
    <AbsoluteFill
      style={{
        // The palette's first colour, not black. A gap between two pictures —
        // or a picture that failed to draw — then reads as part of the film
        // rather than as a hole in it.
        backgroundColor: project.style.palette[0] ?? "#1a1512",
      }}
    >
      {timing.shots.map((shot, i) => (
        <Sequence
          key={`${shot.id}-${i}`}
          // Started early by the length of the fade so the incoming picture
          // overlaps the outgoing one. Sequences that merely abut cannot
          // cross-fade; they can only cut.
          from={Math.max(0, shot.from - (i === 0 ? 0 : FADE))}
          durationInFrames={shot.durationInFrames + FADE}
          name={`${i + 1}. ${shot.image}`}
          layout="none"
        >
          <Shot shot={shot} first={i === 0} />
        </Sequence>
      ))}

      {project.audioUrl ? <Audio src={project.audioUrl} /> : null}
    </AbsoluteFill>
  );
};
