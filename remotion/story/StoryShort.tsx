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
  resolveShortTiming,
  storyTakes,
  type ResolvedShot,
  type StoryProject,
  type StoryShort,
  type StorySound,
  type StoryTake,
} from "../../lib/story";

/**
 * A sixty-second vertical cut of a finished film.
 *
 * Nothing here is generated. The pictures, the narration, the sound design and
 * the cut all come from the film — this composition only frames them for a
 * phone held upright, and adds the two things a short cannot do without: a
 * spoken opening line and text on screen.
 *
 * The text is not a nicety. Shorts are watched with the sound off far more
 * often than not, so a short without burnt-in words is a short nobody follows.
 * It is drawn here rather than shipped as a subtitle file because nobody
 * uploads a subtitle file to a vertical feed.
 */

export const WIDTH = 1080;
export const HEIGHT = 1920;

/** Frames of cross-fade between two pictures, as in the long film. */
export const FADE = 9;

/**
 * The picture is cropped, and the move is what gives the loss back.
 *
 * A 16:9 drawing shown full-bleed on a 9:16 canvas leaves about a third of its
 * width on screen; the other two thirds sit outside the frame. Panning across
 * them turns that from a loss into a reveal — over four seconds a viewer sees
 * most of the picture, just not all at once.
 *
 * It is safe to crop this hard only because of how these pictures were ordered.
 * FRAMING.story in lib/gemini.ts asks for the subject away from the extreme
 * edges with air on all four sides, so the middle third is where the subject
 * actually is. A photograph composed to the edges would lose its subject here.
 */
const PAN = 30;
const ZOOM = 0.1;

function hash01(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100_000) / 100_000;
}

const Picture: React.FC<{
  url?: string;
  id: string;
  motion: string;
  durationInFrames: number;
  first: boolean;
  fps: number;
}> = ({ url, id, motion, durationInFrames, first, fps }) => {
  const frame = useCurrentFrame();
  const offset = first ? 0 : FADE;
  const progress = Math.min(
    1,
    Math.max(0, (frame - offset) / Math.max(1, durationInFrames)),
  );
  const eased = progress * progress * (3 - 2 * progress);

  const seconds = Math.max(0.5, durationInFrames / fps);
  const pace = Math.min(1.4, Math.max(0.6, seconds / 4));
  // Which way across the picture. Taken from the film's own motion where it
  // says something horizontal, and from the shot id otherwise, so the same
  // picture pans the same way every time it is rendered.
  const dir =
    motion === "left" ? -1 : motion === "right" ? 1 : hash01(id) < 0.5 ? -1 : 1;

  // Panned with object-position, not with a transform.
  //
  // The first attempt moved the element and left a bar of background at the
  // edge, because objectFit crops INSIDE the box: shifting the box does not
  // shift the crop, it just uncovers what is behind it. object-position moves
  // the crop window across the picture while the box stays exactly where it
  // is, so no edge can ever appear.
  //
  // Zoom stays a transform, which is safe in a way a translate is not: scaling
  // up only ever covers more.
  const travel = PAN * pace;
  const x = 50 - travel / 2 + (dir < 0 ? travel - travel * eased : travel * eased);
  const scale = 1 + ZOOM * pace * (motion === "out" ? 1 - eased : eased);

  const opacity = first
    ? 1
    : interpolate(frame, [0, FADE], [0, 1], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      });

  if (!url) return null;

  return (
    <AbsoluteFill style={{ opacity }}>
      <Img
        src={url}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          objectPosition: `${x.toFixed(2)}% 50%`,
          transform: `scale(${scale.toFixed(4)})`,
          willChange: "transform, object-position",
        }}
      />
    </AbsoluteFill>
  );
};

/**
 * The spoken line on screen, and the sentences after it.
 *
 * One block, low enough to clear a phone's own furniture at the top and the
 * feed's buttons at the bottom. Set large: the test is whether it reads at
 * arm's length on a phone, not whether it looks balanced on a monitor.
 */
export const Caption: React.FC<{
  text: string;
  accent: string;
  hook?: boolean;
  /**
   * Wo der Satz steht.
   *
   * Mittig ist richtig, wenn dahinter ein formatfüllendes Bild liegt. Beim
   * Finanz-Format liegt dort ein Diagramm im oberen Drittel, und ein Satz
   * quer darüber verdeckt genau das, was der Zuschauer gerade lesen soll.
   */
  align?: "center" | "bottom";
}> = ({ text, accent, hook, align }) => {
  const centred = (align ?? (hook ? "center" : "bottom")) === "center";
  return (
  <AbsoluteFill
    style={{
      justifyContent: centred ? "center" : "flex-end",
      alignItems: "center",
      padding: centred ? "0 90px" : "0 70px 430px",
    }}
  >
    <span
      style={{
        display: "inline",
        boxDecorationBreak: "clone",
        WebkitBoxDecorationBreak: "clone",
        background: "rgba(9,12,17,0.82)",
        color: "#fff",
        padding: hook ? "18px 26px" : "12px 20px",
        fontFamily: "ArchivoExpanded, ui-sans-serif, system-ui, sans-serif",
        fontWeight: 700,
        fontSize: hook ? 78 : 60,
        lineHeight: 1.28,
        letterSpacing: "-0.01em",
        textAlign: "center",
        textWrap: "balance",
        borderBottom: hook ? `8px solid ${accent}` : undefined,
      }}
    >
      {text}
    </span>
  </AbsoluteFill>
  );
};

/**
 * Was in einer Einstellung zu sehen ist.
 *
 * Herausgezogen, als das Finanz-Format eigene Shorts bekam. Alles andere an
 * einem Short — Hook, Untertitel je Satz, Klangteppiche, Akzente, die aus dem
 * Film geschnittene Tonspur — ist in beiden Formaten Zeile für Zeile dasselbe.
 * Nur der Schirm unterscheidet sich: dort ein wanderndes Bild, hier ein
 * Diagramm. Zwei Dateien wären zwei Orte, an denen dieselbe Tonkorrektur
 * gemacht werden müsste.
 */
export type ShortVisual = React.FC<{
  take: StoryTake;
  project: StoryProject;
  /** Ohne Überblendung starten. Nur die allererste Einstellung tut das. */
  first: boolean;
  /**
   * Wieviele Frames dieselbe Grafik VOR dieser Sequenz schon zu sehen war.
   *
   * Der Hook läuft über der ersten Einstellung des Ausschnitts. Ohne diese
   * Zahl fängt dieselbe Grafik danach von vorn an — beim Video-Format eine
   * zurückspringende Kamerafahrt, beim Finanz-Format Balken, die auf null
   * schrumpfen und noch einmal wachsen.
   */
  elapsed: number;
}>;

const PictureTake: ShortVisual = ({ take, project, first }) => (
  <Picture
    url={take.url}
    id={take.id}
    motion={take.motion}
    durationInFrames={take.durationInFrames}
    first={first}
    fps={project.fps}
  />
);

export const StoryShortVideo: React.FC<{
  project: StoryProject;
  short: StoryShort;
}> = (props) => <ShortVideo {...props} Visual={PictureTake} />;

export const ShortVideo: React.FC<{
  project: StoryProject;
  short: StoryShort;
  Visual: ShortVisual;
  /** Wo der Hook-Satz steht. Siehe Caption. */
  hookAlign?: "center" | "bottom";
}> = ({ project, short, Visual, hookAlign }) => {
  const timing = resolveShortTiming(project, short);
  const takes = storyTakes({
    shots: timing.shots,
    totalFrames: timing.totalFrames,
    audioSeconds: timing.narrationSeconds,
    estimated: false,
  });
  const byKey = new Map((project.sounds ?? []).map((s) => [s.key, s]));
  const accent = project.style.palette[1] ?? "#c89b3c";

  // The hook holds on the excerpt's first picture rather than on a card of its
  // own: a short that opens on a title screen has spent its first second on
  // something nobody came for.
  const opening = timing.shots[0];

  const beds: { sound: StorySound; from: number; durationInFrames: number }[] = [];
  for (const shot of timing.shots) {
    const sound = shot.ambience ? byKey.get(shot.ambience) : undefined;
    if (!sound?.url) continue;
    const open = beds[beds.length - 1];
    if (
      open &&
      open.sound.key === sound.key &&
      open.from + open.durationInFrames === shot.from
    ) {
      open.durationInFrames += shot.durationInFrames;
    } else {
      beds.push({ sound, from: shot.from, durationInFrames: shot.durationInFrames });
    }
  }

  return (
    <AbsoluteFill
      style={{ backgroundColor: project.style.palette[0] ?? "#12100e" }}
    >
      {timing.hookFrames > 0 && opening ? (
        <Sequence
          from={0}
          durationInFrames={timing.hookFrames + FADE}
          name="Hook"
          layout="none"
        >
          <Visual
            take={{
              id: `hook-${short.id}`,
              image: opening.image,
              url: opening.url,
              motion: "right",
              from: 0,
              durationInFrames: timing.hookFrames,
              shots: 1,
              // Ein Takt: unter dem Hook entsteht der erste Schritt der
              // Grafik und mehr nicht — geredet wird über den Hook.
              beats: [0],
            }}
            project={project}
            first
            elapsed={0}
          />
          <Caption text={short.hook} accent={accent} hook align={hookAlign} />
        </Sequence>
      ) : null}

      {takes.map((take, i) => (
        <Sequence
          key={`${take.id}-${i}`}
          from={Math.max(0, take.from - (i === 0 && timing.hookFrames === 0 ? 0 : FADE))}
          durationInFrames={take.durationInFrames + FADE}
          name={`${i + 1}. ${take.image}`}
          layout="none"
        >
          <Visual
            take={take}
            project={project}
            first={i === 0 && timing.hookFrames === 0}
            // Die erste Einstellung lief schon unter dem Hook — sie macht
            // weiter, statt neu anzufangen.
            elapsed={i === 0 ? timing.hookFrames : 0}
          />
        </Sequence>
      ))}

      {/*
        One caption per sentence, not per take: a take can carry three
        sentences, and holding the first of them on screen while the other two
        are spoken is worse than no text at all.
      */}
      {timing.shots.map((shot: ResolvedShot, i) => (
        <Sequence
          key={`cap-${shot.id}-${i}`}
          from={shot.from}
          durationInFrames={shot.durationInFrames}
          name={`„${shot.text.slice(0, 24)}…"`}
          layout="none"
        >
          <Caption text={shot.text} accent={accent} />
        </Sequence>
      ))}

      {beds.map((bed, i) => (
        <Sequence
          key={`bed-${i}`}
          from={bed.from}
          durationInFrames={bed.durationInFrames}
          name={`≈ ${bed.sound.key}`}
          layout="none"
        >
          <Audio src={bed.sound.url!} volume={project.soundLevel} loop />
        </Sequence>
      ))}

      {timing.shots.map((shot, i) => {
        const sound = shot.accent ? byKey.get(shot.accent) : undefined;
        if (!sound?.url) return null;
        return (
          <Sequence
            key={`acc-${i}`}
            from={shot.from}
            durationInFrames={Math.max(
              1,
              Math.round((sound.audioSeconds ?? sound.seconds) * project.fps),
            )}
            name={`! ${sound.key}`}
            layout="none"
          >
            <Audio src={sound.url} volume={Math.min(1, project.soundLevel * 2.4)} />
          </Sequence>
        );
      })}

      {short.hookAudioUrl && timing.hookFrames > 0 ? (
        <Sequence from={0} durationInFrames={timing.hookFrames} layout="none">
          <Audio src={short.hookAudioUrl} />
        </Sequence>
      ) : null}

      {/*
        The film's own recording, played from where the excerpt begins. Not a
        new file and not a new take: trimming what already exists is the only
        way a short can be exactly in sync with the film it was cut from.
      */}
      {project.audioUrl ? (
        <Sequence
          from={timing.hookFrames}
          durationInFrames={Math.max(
            1,
            Math.round(timing.narrationSeconds * project.fps),
          )}
          layout="none"
        >
          <Audio
            src={project.audioUrl}
            startFrom={Math.round(timing.narrationFrom * project.fps)}
          />
        </Sequence>
      ) : null}
    </AbsoluteFill>
  );
};

export const SHORT_SIZE = { width: WIDTH, height: HEIGHT };
