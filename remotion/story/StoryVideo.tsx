import React from "react";
import {
  AbsoluteFill,
  Img,
  interpolate,
  Sequence,
  useCurrentFrame,
} from "remotion";
import {
  resolveStoryTiming,
  shotMove,
  storyTakes,
  type StoryProject,
  type StoryTake,
} from "../../lib/story";
import { Soundtrack } from "./Soundtrack";

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

/**
 * The move itself lives in lib/story.ts.
 *
 * It used to be here as two constants and a switch, which meant every picture
 * travelled exactly as far as every other one at exactly the same speed —
 * correct, and after a minute invisible. Working it out per shot from its own
 * length and id needs no React and is worth being able to test on its own, so
 * it moved. See shotMove().
 */

const Take: React.FC<{ take: StoryTake; first: boolean; fps: number }> = ({
  take,
  first,
  fps,
}) => {
  const frame = useCurrentFrame();

  // Every take but the first begins FADE frames before its nominal start, so
  // that its opening overlaps the outgoing picture. The move has to be
  // measured from the nominal start, not from the sequence's — otherwise the
  // camera sits still through the whole cross-fade and then sets off.
  const offset = first ? 0 : FADE;
  const progress = Math.min(
    1,
    Math.max(0, (frame - offset) / Math.max(1, take.durationInFrames)),
  );

  // Smoothstep, so the move eases in and out instead of starting and stopping
  // dead. A linear pan is the other reliable way to make this read as software
  // rather than as a camera.
  const eased = progress * progress * (3 - 2 * progress);
  const move = shotMove(take, fps);
  const at = (from: number, to: number) => from + (to - from) * eased;

  // The first picture has nothing to fade up from, so it simply starts.
  const opacity = first
    ? 1
    : interpolate(frame, [0, FADE], [0, 1], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      });

  if (!take.url) return null;

  return (
    <AbsoluteFill style={{ opacity }}>
      <Img
        src={take.url}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          // Translate written before scale on purpose: transforms compose
          // outermost-first, so this displaces the already-scaled picture by a
          // percentage of the FRAME. The other order would scale the
          // displacement too, and the edge-safety margin in shotMove() —
          // which assumes the plain percentage — would be too small.
          transform: `translate(${at(move.fromX, move.toX).toFixed(3)}%, ${at(
            move.fromY,
            move.toY,
          ).toFixed(3)}%) scale(${at(move.fromScale, move.toScale).toFixed(4)})`,
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
  const takes = storyTakes(timing);
  return (
    <AbsoluteFill
      style={{
        // The palette's first colour, not black. A gap between two pictures —
        // or a picture that failed to draw — then reads as part of the film
        // rather than as a hole in it.
        backgroundColor: project.style.palette[0] ?? "#1a1512",
      }}
    >
      {/*
        One sequence per TAKE, not per shot. Several sentences on the same
        picture are one continuous appearance with one continuous camera move —
        no cross-fade of the picture into itself, no camera snapping back to
        the start of a new move. See storyTakes().
      */}
      {takes.map((take, i) => (
        <Sequence
          key={`${take.id}-${i}`}
          // Started early by the length of the fade so the incoming picture
          // overlaps the outgoing one. Sequences that merely abut cannot
          // cross-fade; they can only cut.
          from={Math.max(0, take.from - (i === 0 ? 0 : FADE))}
          durationInFrames={take.durationInFrames + FADE}
          name={`${i + 1}. ${take.image}${take.shots > 1 ? ` (${take.shots} Sätze)` : ""}`}
          layout="none"
        >
          <Take take={take} first={i === 0} fps={project.fps} />
        </Sequence>
      ))}

      <Soundtrack project={project} timing={timing} />
    </AbsoluteFill>
  );
};
