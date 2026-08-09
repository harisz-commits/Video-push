import { z } from "zod";

/**
 * The contract between every part of the system:
 * Claude writes it, the studio UI edits it, Remotion renders it.
 */

export const ICON_NAMES = [
  "wheat",
  "barn",
  "tractor",
  "soil",
  "ship",
  "factory",
  "flame",
  "fertilizer",
  "sun",
  "droplet",
  "cart",
  "gear",
  "satellite",
  "seed",
  "recycle",
  "shelf",
  "coin",
  "chart",
] as const;

export const IconName = z.enum(ICON_NAMES);
export type IconName = z.infer<typeof IconName>;

export const Panel = z.object({
  icon: IconName,
  label: z.string(),
  caption: z.string().optional(),
});
export type Panel = z.infer<typeof Panel>;

/**
 * Fields shared by every scene.
 *
 * `durationInFrames` is a placeholder only. It is always overwritten by
 * `resolveSceneTimings()` from the ElevenLabs character timestamps — no
 * duration in this project is ever authored by hand.
 */
const sceneBase = {
  id: z.string(),
  durationInFrames: z.number().int().positive(),
  anchorPhrase: z.string().optional(),
  headline: z.string().optional(),
  sub: z.string().optional(),
  /**
   * Which half of the story this scene belongs to. Drives the one colour turn
   * in the film: "crisis" scenes accent in wheat, "solution" scenes in mint,
   * with an 8-frame cross-fade on the first scene that switches.
   *
   * Data rather than a hardcoded scene index, so the turn lands wherever the
   * script actually turns.
   */
  phase: z.enum(["crisis", "solution"]).default("crisis"),
};

export const Scene = z.discriminatedUnion("type", [
  z.object({
    ...sceneBase,
    type: z.literal("hook"),
    kicker: z.string().optional(),
  }),
  z.object({
    ...sceneBase,
    type: z.literal("counter"),
    values: z
      .array(
        z.object({
          label: z.string(),
          value: z.number(),
          suffix: z.string().optional(),
        }),
      )
      .min(1)
      .max(3),
  }),
  z.object({
    ...sceneBase,
    type: z.literal("iconGrid"),
    icon: IconName,
    total: z.number().int().positive().max(64),
    remaining: z.number().int().nonnegative(),
  }),
  z.object({
    ...sceneBase,
    type: z.literal("mapFlow"),
    region: z.enum(["europe", "world"]),
    flows: z
      .array(
        z.object({
          from: z.string(),
          to: z.string(),
          label: z.string().optional(),
        }),
      )
      .min(1),
  }),
  z.object({
    ...sceneBase,
    type: z.literal("chain"),
    nodes: z.array(z.object({ icon: IconName, label: z.string() })).min(2),
    breakAt: z.number().int().nonnegative(),
  }),
  z.object({
    ...sceneBase,
    type: z.literal("split"),
    left: Panel,
    right: Panel,
    connector: z.string().optional(),
  }),
  z.object({
    ...sceneBase,
    type: z.literal("chart"),
    variant: z.enum(["line", "bar"]),
    series: z.array(z.number()).min(2),
    labels: z.array(z.string()).min(2),
    unit: z.string().optional(),
  }),
  z.object({
    ...sceneBase,
    type: z.literal("pillars"),
    pillars: z.array(z.string()).min(2).max(6),
    unstableIndex: z.number().int().nonnegative(),
    carries: z.string(),
  }),
  z.object({
    ...sceneBase,
    type: z.literal("closer"),
    statement: z.string(),
  }),
]);
export type Scene = z.infer<typeof Scene>;
export type SceneType = Scene["type"];

export const Alignment = z.object({
  characters: z.array(z.string()),
  startTimesSeconds: z.array(z.number()),
  endTimesSeconds: z.array(z.number()),
});
export type Alignment = z.infer<typeof Alignment>;

export const VideoProject = z.object({
  id: z.string(),
  topic: z.string(),
  title: z.string(),
  voiceover: z.string(),
  audioUrl: z.string().url().optional(),
  alignment: Alignment.optional(),
  captions: z.boolean().default(true),
  fps: z.literal(30).default(30),
  width: z.literal(1920).default(1920),
  height: z.literal(1080).default(1080),
  scenes: z.array(Scene).min(1),
});
export type VideoProject = z.infer<typeof VideoProject>;

/**
 * What Claude is asked to produce. The runtime fields (id, audio, alignment,
 * frame counts) are filled in by us, not by the model — asking a model to
 * invent an id or a frame count only creates something to throw away.
 */
/** Fields every drafted scene carries, kept in one place so they cannot drift. */
const draftBase = {
  anchorPhrase: z.string(),
  headline: z.string().optional(),
  sub: z.string().optional(),
  phase: z.enum(["crisis", "solution"]).optional(),
};

export const ScriptDraft = z.object({
  title: z.string(),
  voiceover: z.string(),
  scenes: z
    .array(
      z.discriminatedUnion("type", [
        z.object({
          ...draftBase,
          type: z.literal("hook"),
          kicker: z.string().optional(),
        }),
        z.object({
          ...draftBase,
          type: z.literal("counter"),
          values: z
            .array(
              z.object({
                label: z.string(),
                value: z.number(),
                suffix: z.string().optional(),
              }),
            )
            .min(1)
            .max(3),
        }),
        z.object({
          ...draftBase,
          type: z.literal("iconGrid"),
          icon: IconName,
          total: z.number().int(),
          remaining: z.number().int(),
        }),
        z.object({
          ...draftBase,
          type: z.literal("mapFlow"),
          region: z.enum(["europe", "world"]),
          flows: z
            .array(
              z.object({
                from: z.string(),
                to: z.string(),
                label: z.string().optional(),
              }),
            )
            .min(1),
        }),
        z.object({
          ...draftBase,
          type: z.literal("chain"),
          nodes: z
            .array(z.object({ icon: IconName, label: z.string() }))
            .min(2),
          breakAt: z.number().int(),
        }),
        z.object({
          ...draftBase,
          type: z.literal("split"),
          left: Panel,
          right: Panel,
          connector: z.string().optional(),
        }),
        z.object({
          ...draftBase,
          type: z.literal("chart"),
          variant: z.enum(["line", "bar"]),
          series: z.array(z.number()).min(2),
          labels: z.array(z.string()).min(2),
          unit: z.string().optional(),
        }),
        z.object({
          ...draftBase,
          type: z.literal("pillars"),
          pillars: z.array(z.string()).min(2).max(6),
          unstableIndex: z.number().int(),
          carries: z.string(),
        }),
        z.object({
          ...draftBase,
          type: z.literal("closer"),
          statement: z.string(),
        }),
      ]),
    )
    .min(6)
    .max(16),
});
export type ScriptDraft = z.infer<typeof ScriptDraft>;

/** Request/response bodies for the API routes. */
export const ScriptRequest = z.object({
  topic: z.string().min(3).max(200),
});

export const VoiceRequest = z.object({
  projectId: z.string().min(1).max(100),
  voiceover: z.string().min(50),
  voiceId: z.string().min(1).max(100).optional(),
});

export const RenderRequest = z.object({
  project: VideoProject,
});

export function draftToProject(
  draft: ScriptDraft,
  topic: string,
  id: string,
): VideoProject {
  return VideoProject.parse({
    id,
    topic,
    title: draft.title,
    voiceover: draft.voiceover,
    captions: true,
    fps: 30,
    width: 1920,
    height: 1080,
    scenes: draft.scenes.map((scene, i) => ({
      ...scene,
      id: `s${String(i + 1).padStart(2, "0")}`,
      // Placeholder. resolveSceneTimings() overwrites this the moment audio exists.
      durationInFrames: 90,
    })),
  });
}
