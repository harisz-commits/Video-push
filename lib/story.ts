import { z } from "zod";
import { spellNumbers } from "./say-numbers";
import { ThumbnailConfig } from "./thumbnail";

/**
 * The video format: a spoken story over a stream of drawn pictures.
 *
 * The third format, and it borrows its clock from the first one rather than
 * the second. A quiz is timed by a countdown, an infographics film by the
 * voice — and this is timed by the voice too, because the pictures illustrate
 * what is being said and a picture that changes before its sentence is
 * finished is worse than no picture at all.
 *
 * What is genuinely new here is that the pictures are generated rather than
 * drawn in code, which creates a problem the other two formats do not have: a
 * hundred images asked for one at a time come back looking like a hundred
 * different videos. Hence `style` — one recipe, decided once from the topic and
 * appended verbatim to every single image prompt. It is not decoration; it is
 * the only thing standing between this format and a slideshow that looks
 * scraped together.
 *
 * Not named VideoProject: that name belongs to the infographics format, which
 * had it first. See lib/schema.ts.
 */

/**
 * The look, fixed once per video.
 *
 * `directive` is the part that actually does the work — it is pasted into
 * every image prompt unchanged, so every picture is drawn by the same
 * instructions about technique, palette, line and perspective. Two images can
 * show completely different things and still be recognisably from one hand.
 */
export const StoryStyle = z.object({
  /** A short name for the look, so the studio can show what it decided. */
  name: z.string().min(3).max(80),
  /** Appended to every image prompt, verbatim. The reason they match. */
  directive: z.string().min(40).max(1200),
  /** Hex colours, for the studio to show and for the letterbox behind images. */
  palette: z.array(z.string().regex(/^#[0-9a-fA-F]{6}$/)).min(2).max(6),
});
export type StoryStyle = z.infer<typeof StoryStyle>;

/**
 * A figure that comes back.
 *
 * Optional, and described by the person making the video rather than invented
 * by the model — "ein Forscher mit rotem Anorak und Klemmbrett". Without one
 * the format draws people as anonymous stick figures, which is the right
 * default for an explainer and the wrong one for a series that wants a face.
 *
 * Two descriptions, and the split is the point. `description` is what the user
 * wrote, in their own words and their own language; it is what gets saved to
 * the library and what survives being reused in a completely different film.
 * `appearance` is that same figure translated into the film's own look, in
 * English, at the time the style is decided — so the same character is a
 * silk-screen silhouette in one video and a watercolour figure in the next,
 * which is what makes reuse across styles possible at all.
 */
export const StoryCharacter = z.object({
  key: z.string().regex(/^[a-z0-9][a-z0-9-]{2,79}$/),
  /** How the studio names it. German, as written. */
  name: z.string().min(2).max(80),
  /** What the user asked for, verbatim. The source of truth for reuse. */
  description: z.string().min(3).max(600),
  /** The same figure in this film's style, English, for the image prompts. */
  appearance: z.string().max(700).optional(),
});
export type StoryCharacter = z.infer<typeof StoryCharacter>;

/**
 * One generated picture, and its name.
 *
 * The name is the point. An image called "aegypten-lehmziegelhaus-seitlich"
 * can be recognised, reused in a later video, and replaced on purpose;
 * "image-47.png" can only be regenerated and paid for again. Naming is
 * therefore not a nicety here but the mechanism the whole library rests on —
 * see lib/image-library.ts.
 */
export const StoryImage = z.object({
  /** Slug, unique within the project and the key into the library. */
  key: z.string().regex(/^[a-z0-9][a-z0-9-]{2,79}$/),
  /** Plain-language name, for the studio's list. */
  name: z.string().min(3).max(120),
  /** What was asked for, without the style directive. Kept so it can be redrawn. */
  prompt: z.string().min(10).max(700),
  url: z.string().url().optional(),
  /**
   * A small copy, for the studio's list.
   *
   * Its own field rather than a URL the browser derives, because the list used
   * to point at `url` — the full drawing — to fill a 48-pixel row, and paid
   * for the whole file every time the project was opened. See
   * lib/image-library.ts.
   */
  thumbUrl: z.string().url().optional(),
  /** Which model drew it, so a mixed-model project is not a mystery later. */
  model: z.string().optional(),
  /** True when this came out of the library instead of being paid for again. */
  reused: z.boolean().optional(),
  /**
   * Which recurring figures appear in it, by key.
   *
   * Named by the writer rather than detected from the prompt text, for the
   * same reason ambience and accent are: matching a German character name
   * against an English subject description would work most of the time, and
   * the times it did not would be silent.
   */
  characters: z.array(z.string()).optional(),
});
export type StoryImage = z.infer<typeof StoryImage>;

/**
 * How a still is moved while it is on screen.
 *
 * Every picture gets one. A cut between two motionless images reads as a
 * slideshow no matter how good the images are, and a slow push or drift costs
 * nothing — which is also what makes reuse invisible: the same picture with a
 * different move is not obviously the same shot.
 */
export const ShotMotion = z.enum(["in", "out", "left", "right", "up", "down"]);
export type ShotMotion = z.infer<typeof ShotMotion>;

export const StoryShot = z.object({
  id: z.string(),
  /** What is spoken while this picture is up. Two to four seconds' worth. */
  text: z.string().min(1).max(400),
  /** Which picture, by key. Several shots may name the same one. */
  image: z.string(),
  motion: ShotMotion.default("in"),
  /**
   * The bed running underneath, by key.
   *
   * Consecutive shots naming the same bed share one continuous playback — a
   * wind that restarted every three seconds would be the most obvious tell
   * that this is a slideshow with noise on top.
   */
  ambience: z.string().optional(),
  /**
   * A one-shot sound fired as this shot begins, by key.
   *
   * This is where the format gets its punctuation: a bone cracking, a stone
   * struck, a gust arriving. Sparingly — an accent on every shot is not sound
   * design, it is a drum machine.
   */
  accent: z.string().optional(),
});
export type StoryShot = z.infer<typeof StoryShot>;

/**
 * A generated sound, either a bed or a hit.
 *
 * Named and stored exactly like the pictures, for exactly the same reason: a
 * bed called "wind-ueber-schnee" can be recognised, reused in the next film
 * and redrawn on purpose. See lib/image-library.ts, which this borrows.
 */
export const StorySound = z.object({
  key: z.string().regex(/^[a-z0-9][a-z0-9-]{2,79}$/),
  name: z.string().min(3).max(120),
  /** What to generate, in English — the models follow it far more reliably. */
  prompt: z.string().min(6).max(400),
  kind: z.enum(["ambience", "accent"]),
  /**
   * Seconds asked for.
   *
   * Beds are short and looped rather than generated at full length: a bed
   * under a two-minute section would cost as much as the narration itself,
   * and a ten-second loop of wind is indistinguishable from two minutes of it.
   */
  seconds: z.number().min(0.5).max(22),
  url: z.string().url().optional(),
  /** How long the file really is, which decides where a loop restarts. */
  audioSeconds: z.number().positive().optional(),
  reused: z.boolean().optional(),
});
export type StorySound = z.infer<typeof StorySound>;

export const StoryProject = z.object({
  kind: z.literal("video"),
  id: z.string(),
  topic: z.string(),
  title: z.string(),
  style: StoryStyle,
  /** Figures that recur, if the film was given any. See StoryCharacter. */
  characters: z.array(StoryCharacter).default([]),
  images: z.array(StoryImage).min(1),
  sounds: z.array(StorySound).default([]),
  shots: z.array(StoryShot).min(1),
  /**
   * How many distinct pictures a minute was asked for.
   *
   * Kept on the project so the number survives a reload and so the studio can
   * say what a film was built to, rather than inferring it from a count that
   * the writer was free to undershoot. Purely informational — the budget it
   * produced is already baked into the image list.
   */
  imagesPerMinute: z.number().min(0.5).max(20).optional(),
  /**
   * How loud the beds and hits sit under the voice.
   *
   * Low by default and adjustable, because this is the one setting where
   * taste and headphones disagree: what reads as atmosphere on a phone
   * speaker is a wind tunnel in good headphones.
   */
  soundLevel: z.number().min(0).max(1).default(0.22),
  /**
   * How fast it is read.
   *
   * Above one on purpose: a normal German reading lands near 130 words a
   * minute, slow enough for this format to lose people.
   *
   * Measured on a two-minute film: 1.15 produced 146 words a minute, under
   * the 150 this format aims for. 1.2 is ElevenLabs' ceiling and lands near
   * 152, so that is the default and there is no room above it.
   */
  speed: z.number().min(0.7).max(1.2).default(1.2),
  /**
   * Which voice read it, so a project can be re-spoken by the same one later.
   */
  voice: z
    .object({
      provider: z.enum(["elevenlabs"]).default("elevenlabs"),
      /** The ElevenLabs voice id. Named `name` since before there was a label. */
      name: z.string().max(120).optional(),
      /** What that id is called, so the studio need not hold the list to show it. */
      label: z.string().max(120).optional(),
      /** Which speaking model read it. See lib/speech-models.ts. */
      model: z.string().max(80).optional(),
      /** The language it was told to read, where the model accepts one. */
      language: z.string().max(16).optional(),
    })
    .optional(),
  /**
   * When each shot starts, in seconds.
   *
   * The one timing fact this format needs, and both providers can produce it:
   * Google reports it directly from the <mark> tags, ElevenLabs' character
   * timestamps are reduced to it at synthesis time. Storing the answer rather
   * than the evidence is what lets the two be swapped without anything
   * downstream knowing which one spoke.
   */
  cues: z.array(z.number().nonnegative()).optional(),
  /** How long the recording is. Needed when there is no alignment to measure. */
  audioSeconds: z.number().positive().optional(),
  audioUrl: z.string().url().optional(),
  alignment: z
    .object({
      characters: z.array(z.string()),
      startTimesSeconds: z.array(z.number()),
      endTimesSeconds: z.array(z.number()),
    })
    .optional(),
  thumbnail: ThumbnailConfig.optional(),
  fps: z.literal(30).default(30),
  width: z.literal(1920).default(1920),
  height: z.literal(1080).default(1080),
});
export type StoryProject = z.infer<typeof StoryProject>;

/** Frames of silence after the last word, so the end does not snap shut. */
export const STORY_TAIL_FRAMES = 40;

/** A shot may never be shorter than this, whatever the arithmetic says. */
const MIN_SHOT_FRAMES = 45;

/** Speaking rate used only to fake a timeline before any audio exists. */
const ESTIMATED_WPM = 160;

export type ResolvedShot = StoryShot & {
  from: number;
  durationInFrames: number;
  image: string;
  /** The picture itself, already looked up. Null when it was never drawn. */
  url?: string;
};

export type StoryTiming = {
  shots: ResolvedShot[];
  totalFrames: number;
  audioSeconds: number;
  /** True when there is no voice yet and the timeline is a guess. */
  estimated: boolean;
};

/**
 * What the voice was actually given.
 *
 * Numbers reach ElevenLabs as words, so the timestamps belong to the spelled
 * text and every offset has to be measured in it. Building the narration here
 * rather than storing it means the two can never drift apart.
 */
export function spokenNarration(project: StoryProject): string {
  return project.shots.map((s) => spellNumbers(s.text.trim())).join(" ");
}

/**
 * Where each shot begins, measured from ElevenLabs' character timestamps.
 *
 * The reduction that makes the two providers interchangeable: Google hands
 * back one time per shot already, and this turns per-character times into the
 * same shape. Everything downstream then reads cues and never asks who spoke.
 */
export function cuesFromAlignment(
  project: StoryProject,
  alignment: { startTimesSeconds: number[] },
): number[] {
  return cuesForSegments(
    project.shots.map((s) => spellNumbers(s.text.trim())),
    alignment,
  );
}

/**
 * The same reduction for an arbitrary run of segments.
 *
 * Split out because a long narration is recorded in several requests — the
 * voice takes 9,500 characters at a time — and each recording has to be
 * measured against only the segments that went into it.
 */
export function cuesForSegments(
  spoken: string[],
  alignment: { startTimesSeconds: number[] },
): number[] {
  const narration = spoken.join(" ");
  const n = alignment.startTimesSeconds.length;
  const scale = narration.length === n ? 1 : n / Math.max(1, narration.length);

  const cues: number[] = [];
  let cursor = 0;
  for (const text of spoken) {
    const i = Math.round(cursor * scale);
    cues.push(alignment.startTimesSeconds[Math.max(0, Math.min(n - 1, i))] ?? 0);
    cursor += text.length + 1;
  }
  return cues;
}

/**
 * Group segments into runs that each fit one request.
 *
 * Cut between shots, never inside one: a seam between two recordings is
 * audible, and the only place it can hide is where the picture changes anyway.
 */
export function chunkSegments(
  spoken: string[],
  budget: number,
): { segments: string[]; firstIndex: number }[] {
  const chunks: { segments: string[]; firstIndex: number }[] = [];
  let current: string[] = [];
  let firstIndex = 0;
  let size = 0;

  spoken.forEach((text, i) => {
    const cost = text.length + 1;
    if (current.length > 0 && size + cost > budget) {
      chunks.push({ segments: current, firstIndex });
      current = [];
      firstIndex = i;
      size = 0;
    }
    current.push(text);
    size += cost;
  });

  if (current.length > 0) chunks.push({ segments: current, firstIndex });
  return chunks;
}

/** The written narration, for reading and editing. */
export function writtenNarration(project: StoryProject): string {
  return project.shots.map((s) => s.text.trim()).join(" ");
}

/**
 * Where every shot starts.
 *
 * No phrase searching, unlike the infographics format: this format wrote the
 * split itself, so a shot's offset into the narration is simply the length of
 * everything before it. Exact by construction, and it cannot fail to find
 * itself — which is the failure mode anchor phrases have.
 */
export function resolveStoryTiming(project: StoryProject): StoryTiming {
  const fps = project.fps;
  const byKey = new Map(project.images.map((i) => [i.key, i]));
  const spoken = project.shots.map((s) => spellNumbers(s.text.trim()));

  // Measured cues win over everything. They are what both providers now
  // produce, and they are exact — derived from marks Google placed or from
  // character offsets ElevenLabs timed, rather than re-derived here.
  const cues = project.cues;
  if (cues && cues.length === project.shots.length && project.audioSeconds) {
    const endFrame = Math.round(project.audioSeconds * fps) + STORY_TAIL_FRAMES;
    const starts = cues.map((seconds) => Math.round(seconds * fps));
    starts[0] = 0;

    return {
      shots: project.shots.map((shot, i) => {
        const from = starts[i];
        const next = i + 1 < starts.length ? starts[i + 1] : endFrame;
        return {
          ...shot,
          from,
          durationInFrames: Math.max(MIN_SHOT_FRAMES, next - from),
          url: byKey.get(shot.image)?.url,
        } satisfies ResolvedShot;
      }),
      totalFrames: Math.max(1, endFrame),
      audioSeconds: project.audioSeconds,
      estimated: false,
    };
  }

  const alignment = project.alignment;
  const hasAudio = Boolean(alignment && alignment.startTimesSeconds.length > 0);

  if (!hasAudio) {
    // No voice yet. Spread the shots by their word count so the Player has
    // something honest to scrub through, and so the studio can show a length
    // before anybody has paid for a recording.
    let cursor = 0;
    const shots = project.shots.map((shot, i) => {
      const words = spoken[i].split(/\s+/).filter(Boolean).length;
      const durationInFrames = Math.max(
        MIN_SHOT_FRAMES,
        Math.round((words / ESTIMATED_WPM) * 60 * fps),
      );
      const resolved: ResolvedShot = {
        ...shot,
        from: cursor,
        durationInFrames,
        url: byKey.get(shot.image)?.url,
      };
      cursor += durationInFrames;
      return resolved;
    });
    return {
      shots,
      totalFrames: Math.max(1, cursor),
      audioSeconds: cursor / fps,
      estimated: true,
    };
  }

  const align = alignment!;
  const n = align.startTimesSeconds.length;
  const narration = spoken.join(" ");
  const scale = narration.length === n ? 1 : n / Math.max(1, narration.length);
  const at = (charIndex: number) => {
    const i = Math.round(charIndex * scale);
    return align.startTimesSeconds[Math.max(0, Math.min(n - 1, i))] ?? 0;
  };

  // Character offset of each shot within the joined narration.
  const offsets: number[] = [];
  let cursor = 0;
  for (const text of spoken) {
    offsets.push(cursor);
    cursor += text.length + 1; // the joining space
  }

  const audioSeconds =
    align.endTimesSeconds[align.endTimesSeconds.length - 1] ?? 0;
  const endFrame = Math.round(audioSeconds * fps) + STORY_TAIL_FRAMES;

  const starts = offsets.map((o) => Math.round(at(o) * fps));
  starts[0] = 0;

  const shots = project.shots.map((shot, i) => {
    const from = starts[i];
    const next = i + 1 < starts.length ? starts[i + 1] : endFrame;
    return {
      ...shot,
      from,
      durationInFrames: Math.max(MIN_SHOT_FRAMES, next - from),
      url: byKey.get(shot.image)?.url,
    } satisfies ResolvedShot;
  });

  return {
    shots,
    totalFrames: Math.max(1, endFrame),
    audioSeconds,
    estimated: false,
  };
}

/** Seconds of finished video, for the studio to show before anything renders. */
export function storyDurationSeconds(project: StoryProject): number {
  return resolveStoryTiming(project).totalFrames / project.fps;
}

/** How many pictures this project would have to pay for right now. */
export function undrawnImages(project: StoryProject): StoryImage[] {
  return project.images.filter((i) => !i.url);
}

/**
 * One continuous appearance of a picture: a take.
 *
 * The unit the screen actually shows, and it is not the shot. A shot is a
 * sentence — it decides when the narration moves on and where a subtitle
 * breaks. A picture very often carries several of them in a row, and when it
 * does, the viewer is looking at ONE take, not at three cuts to the same
 * image.
 *
 * Treating those as separate shots is what the composition used to do, and it
 * was visibly wrong: the picture cross-faded into itself while the camera
 * jumped back to the start of a fresh move. Cutting to a picture that is
 * already on screen is the one edit that has no meaning at all — there is
 * nothing new to see, so the eye reads it as a mistake.
 *
 * Grouped rather than written this way by the model, because the model is
 * writing sentences and should not have to think about the cut; and because
 * the same grouping has to survive a script being re-timed by a new voice.
 */
export type StoryTake = {
  /** The first shot's id. Also the seed for the camera move. */
  id: string;
  image: string;
  url?: string;
  motion: ShotMotion;
  from: number;
  durationInFrames: number;
  /** How many shots it spans. One is the ordinary case. */
  shots: number;
};

/**
 * Consecutive shots on the same picture, collapsed into one appearance.
 *
 * The same reduction the sound beds get, for the same reason: a wind that
 * restarted every three seconds would give the slideshow away, and so would a
 * picture that cut to itself.
 *
 * Only CONSECUTIVE runs. A motif that comes back later in the film is a real
 * return and gets a real cut — that is the recurrence the format is built on.
 */
export function storyTakes(timing: StoryTiming): StoryTake[] {
  const takes: StoryTake[] = [];

  for (const shot of timing.shots) {
    const open = takes[takes.length - 1];
    // Contiguous, not merely adjacent in the list — but tested as "starts no
    // later than this take ends" rather than as exact equality. Exactness
    // fails on the very shots this format asks for most: a three-word sentence
    // is under MIN_SHOT_FRAMES, gets stretched to it, and its take then
    // overruns the next shot's start by a few frames. Demanding equality there
    // would refuse the merge and put back the cut this whole function exists
    // to remove.
    if (
      open &&
      open.image === shot.image &&
      shot.from <= open.from + open.durationInFrames
    ) {
      open.durationInFrames = Math.max(
        open.durationInFrames,
        shot.from + shot.durationInFrames - open.from,
      );
      open.shots += 1;
      continue;
    }

    takes.push({
      id: shot.id,
      image: shot.image,
      url: shot.url,
      // The first shot's move governs the whole take. The writer chose it for
      // the sentence that introduces the picture, which is the moment the move
      // has to answer to.
      motion: shot.motion,
      from: shot.from,
      durationInFrames: shot.durationInFrames,
      shots: 1,
    });
  }

  return takes;
}

/**
 * The camera move over a still, worked out once per take.
 *
 * Every picture gets one — that is the requirement, and it is not decoration.
 * A format with no real animation has exactly three things carrying tension:
 * the cut, the sound, and the fact that the frame is never at rest. A picture
 * held still for four seconds reads as a slideshow no matter how good it is.
 *
 * Two things make it look deliberate rather than mechanical:
 *
 * 1. The strength varies per shot, from a hash of the shot's id. Constant
 *    amplitude on a hundred shots is its own kind of monotony — the eye
 *    learns the speed within a minute and stops seeing the movement at all.
 * 2. It scales with how long the picture is up. The same travel that is a
 *    gentle drift across five seconds is a whip-pan across one, and a long
 *    take with a short move sits dead for its second half. This is also what
 *    makes a held picture work: three sentences on one still become a single
 *    eight-second move rather than three restarts of a three-second one.
 *
 * Derived from the id rather than drawn at random, because Remotion renders
 * frames in parallel processes: a random number would differ between the
 * process that drew frame 40 and the one that drew frame 41, and the picture
 * would jump. Same input, same move, every time.
 */
export type ShotMove = {
  /** Percent of frame width/height, applied as translate(). */
  fromX: number;
  toX: number;
  fromY: number;
  toY: number;
  fromScale: number;
  toScale: number;
};

/** How far a picture zooms over its whole stay, as a fraction of its size. */
const ZOOM = 0.16;
/** How far it travels sideways or vertically, likewise. */
const PAN = 0.13;
/**
 * Oversize kept beyond whatever the move needs.
 *
 * Without it a picture panned to its limit shows the background at the edge
 * for one frame, which is the single most obvious way this effect goes wrong.
 */
const EDGE = 0.05;
/** How much of a pan is applied on the other axis during a pure zoom. */
const CROSS = 0.34;
/** Nothing moves further than this, whatever the arithmetic says. */
const MAX_ZOOM = 0.26;
const MAX_PAN = 0.2;

export function shotMove(
  shot: { id: string; motion: ShotMotion; durationInFrames: number },
  fps: number,
): ShotMove {
  const seconds = Math.max(0.4, shot.durationInFrames / fps);
  // A shot up for three and a half seconds moves at the reference amount;
  // shorter ones are held back, longer ones are given more ground to cover.
  const pace = Math.min(1.5, Math.max(0.55, seconds / 3.5));
  const varied = 0.7 + 0.6 * hash01(shot.id);
  const amp = pace * varied;

  // Which way the secondary drift goes during a pure zoom. Stable per shot,
  // so the same picture used twice with the same motion still differs.
  const side = hash01(`${shot.id}~`) < 0.5 ? -1 : 1;

  let zoom = Math.min(MAX_ZOOM, ZOOM * amp);
  const pan = Math.min(MAX_PAN, PAN * amp);
  let px = 0;
  let py = 0;

  switch (shot.motion) {
    case "out":
      zoom = -zoom;
      px = side * pan * CROSS;
      break;
    case "left":
      px = -pan;
      zoom *= 0.45;
      break;
    case "right":
      px = pan;
      zoom *= 0.45;
      break;
    case "up":
      py = -pan;
      zoom *= 0.45;
      break;
    case "down":
      py = pan;
      zoom *= 0.45;
      break;
    case "in":
    default:
      // A push that also drifts. Pure centred zoom is the one move that still
      // reads as a slideshow effect rather than as a camera.
      px = side * pan * CROSS;
      break;
  }

  // Big enough that the frame stays covered at the furthest point of the pan:
  // the picture is displaced by at most half the travel, and the overhang at
  // scale s is (s - 1) / 2 on each side.
  const cover = 1 + Math.max(Math.abs(px), Math.abs(py)) + EDGE;

  return {
    fromX: (-px / 2) * 100,
    toX: (px / 2) * 100,
    fromY: (-py / 2) * 100,
    toY: (py / 2) * 100,
    fromScale: zoom >= 0 ? cover : cover - zoom,
    toScale: zoom >= 0 ? cover + zoom : cover,
  };
}

/** A stable number in [0, 1) from a string. See shotMove() for why. */
function hash01(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100_000) / 100_000;
}

/**
 * A short, stable tag for everything about a look that a picture depends on.
 *
 * Not the name: the name is what a person reads and what groups a series, and
 * it deliberately survives small edits. This is what a cached picture is
 * checked against, so it has to move whenever the drawing would.
 *
 * The characters are folded in per image rather than per film — two pictures
 * in the same film differ if one of them has a figure in it and the other does
 * not. See lib/image-library.ts.
 */
export function styleFingerprint(
  style: StoryStyle,
  characters: StoryCharacter[] = [],
): string {
  const source = [
    style.directive.trim(),
    style.palette.join(","),
    ...characters
      .slice()
      .sort((a, b) => a.key.localeCompare(b.key))
      .map((c) => `${c.key}:${c.appearance?.trim() || c.description.trim()}`),
  ].join("|");

  let h = 2166136261;
  for (let i = 0; i < source.length; i++) {
    h ^= source.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}
