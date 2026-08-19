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
  shotMove,
  type ResolvedShot,
  type StoryProject,
  type StorySound,
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

/**
 * The move itself lives in lib/story.ts.
 *
 * It used to be here as two constants and a switch, which meant every picture
 * travelled exactly as far as every other one at exactly the same speed —
 * correct, and after a minute invisible. Working it out per shot from its own
 * length and id needs no React and is worth being able to test on its own, so
 * it moved. See shotMove().
 */

const Shot: React.FC<{ shot: ResolvedShot; first: boolean; fps: number }> = ({
  shot,
  first,
  fps,
}) => {
  const frame = useCurrentFrame();
  const progress = Math.min(
    1,
    Math.max(0, (frame - FADE) / Math.max(1, shot.durationInFrames)),
  );

  // Smoothstep, so the move eases in and out instead of starting and stopping
  // dead. A linear pan is the other reliable way to make this read as software
  // rather than as a camera.
  const eased = progress * progress * (3 - 2 * progress);
  const move = shotMove(shot, fps);
  const at = (from: number, to: number) => from + (to - from) * eased;

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
  const byKey = new Map((project.sounds ?? []).map((s) => [s.key, s]));

  /**
   * Runs of consecutive shots sharing a bed, collapsed into one playback each.
   *
   * The grouping is the point. Nine shots naming the same wind are one sound
   * that keeps going, not nine that each start from the top.
   */
  const beds: { sound: StorySound; from: number; durationInFrames: number }[] = [];
  for (const shot of timing.shots) {
    const sound = shot.ambience ? byKey.get(shot.ambience) : undefined;
    if (!sound?.url) continue;
    const open = beds[beds.length - 1];
    if (open && open.sound.key === sound.key &&
        open.from + open.durationInFrames === shot.from) {
      open.durationInFrames += shot.durationInFrames;
    } else {
      beds.push({
        sound,
        from: shot.from,
        durationInFrames: shot.durationInFrames,
      });
    }
  }

  const accents: { sound: StorySound; from: number; durationInFrames: number }[] =
    [];
  for (const shot of timing.shots) {
    const sound = shot.accent ? byKey.get(shot.accent) : undefined;
    if (!sound?.url) continue;
    accents.push({
      sound,
      from: shot.from,
      // As long as the file is, capped by what is left of the film — a hit
      // hanging past the end would extend nothing but would be cut mid-tail.
      durationInFrames: Math.max(
        1,
        Math.round((sound.audioSeconds ?? sound.seconds) * project.fps),
      ),
    });
  }

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
          <Shot shot={shot} first={i === 0} fps={project.fps} />
        </Sequence>
      ))}

      {/*
        The beds, one continuous playback per run of shots that name the same
        one. Grouped rather than per shot on purpose: a wind that restarted
        every three seconds would be the most obvious tell that this is a
        slideshow with noise laid over it.

        Rendered before the narration so the voice sits on top in the mix.
      */}
      {beds.map((bed, i) => (
        <Sequence
          key={`bed-${i}`}
          from={bed.from}
          durationInFrames={bed.durationInFrames}
          name={`≈ ${bed.sound.key}`}
          layout="none"
        >
          <Audio
            src={bed.sound.url!}
            volume={project.soundLevel}
            // Ten seconds of wind under two minutes of film: it has to come
            // round again, and the loop is inaudible because the material has
            // no beat to fall out of.
            loop
          />
        </Sequence>
      ))}

      {/*
        The accents. Louder than the beds — they are meant to be noticed — and
        each one only as long as it is, so nothing is held open waiting.
      */}
      {accents.map((accent, i) => (
        <Sequence
          key={`accent-${i}`}
          from={accent.from}
          durationInFrames={accent.durationInFrames}
          name={`! ${accent.sound.key}`}
          layout="none"
        >
          <Audio
            src={accent.sound.url!}
            volume={Math.min(1, project.soundLevel * 2.4)}
          />
        </Sequence>
      ))}

      {project.audioUrl ? <Audio src={project.audioUrl} /> : null}
    </AbsoluteFill>
  );
};
