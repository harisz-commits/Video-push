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
  /** Which model drew it, so a mixed-model project is not a mystery later. */
  model: z.string().optional(),
  /** True when this came out of the library instead of being paid for again. */
  reused: z.boolean().optional(),
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
});
export type StoryShot = z.infer<typeof StoryShot>;

export const StoryProject = z.object({
  kind: z.literal("video"),
  id: z.string(),
  topic: z.string(),
  title: z.string(),
  style: StoryStyle,
  images: z.array(StoryImage).min(1),
  shots: z.array(StoryShot).min(1),
  /**
   * How fast it is read, as ElevenLabs' multiplier.
   *
   * Above one on purpose. A normal reading lands near 130 words a minute in
   * German, which for this format is slow enough to lose people; 1.15 puts it
   * around 155-165, the pace of someone who is interested in what they are
   * saying rather than dictating it. ElevenLabs refuses anything above 1.2.
   */
  speed: z.number().min(0.7).max(1.2).default(1.15),
  /**
   * Which voice read it.
   *
   * Two providers, and they differ in more than timbre: ElevenLabs returns a
   * timestamp per character, Google one per SSML mark. Stored so a project can
   * be re-spoken by the same voice later, and so the studio can show which one
   * a finished video actually used.
   */
  voice: z
    .object({
      provider: z.enum(["elevenlabs", "google"]),
      /** Voice id at ElevenLabs, or a name like de-DE-Neural2-D at Google. */
      name: z.string().max(120).optional(),
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
  const spoken = project.shots.map((s) => spellNumbers(s.text.trim()));
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
