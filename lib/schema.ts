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
  z.object({
    ...sceneBase,
    // The narrator carries no data of its own: the mouth reads the alignment
    // and the text comes from headline and sub like every other scene.
    type: z.literal("narrator"),
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
 * What Claude is asked to produce.
 *
 * Deliberately ONE flat scene object rather than the nine-variant union the
 * renderer uses. Structured outputs compile the schema into a grammar, and a
 * discriminated union of nine branches — each with its own nested objects and
 * arrays — exceeds the size the API accepts ("The compiled grammar is too
 * large"). Flattening collapses that to a single object shape.
 *
 * The strictness does not disappear, it moves: every field below is optional
 * here, and `validateDraft` in /api/script checks which ones a given `type`
 * actually requires, naming the missing ones so the repair round can fix them.
 * The strict `Scene` union still guards what reaches the renderer — nothing
 * gets there without passing it.
 *
 * The runtime fields (id, audio, alignment, frame counts) are filled in by us.
 * Asking a model to invent an id or a frame count only creates work to undo.
 */
export const DraftScene = z.object({
  type: z.enum([
    "hook",
    "counter",
    "iconGrid",
    "mapFlow",
    "chain",
    "split",
    "chart",
    "pillars",
    "closer",
    "narrator",
  ]),
  anchorPhrase: z.string(),
  // Required on purpose: nearly every scene carries an on-screen headline, and
  // making phase mandatory forces the model to decide where the film turns
  // from crisis to solution instead of leaving the colour change to a default.
  headline: z.string(),
  phase: z.enum(["crisis", "solution"]),
  sub: z.string().optional(),

  // hook
  kicker: z.string().optional(),
  // counter
  values: z
    .array(
      z.object({
        label: z.string(),
        value: z.number(),
        suffix: z.string().optional(),
      }),
    )
    .optional(),
  // iconGrid
  icon: IconName.optional(),
  total: z.number().int().optional(),
  remaining: z.number().int().optional(),
  // mapFlow
  region: z.enum(["europe", "world"]).optional(),
  flows: z
    .array(
      z.object({
        from: z.string(),
        to: z.string(),
        label: z.string().optional(),
      }),
    )
    .optional(),
  // chain
  nodes: z.array(z.object({ icon: IconName, label: z.string() })).optional(),
  breakAt: z.number().int().optional(),
  // split — one field rather than left plus right, because every optional
  // property counts against the schema's compilation budget.
  panels: z.array(Panel).optional(),
  connector: z.string().optional(),
  // chart
  variant: z.enum(["line", "bar"]).optional(),
  series: z.array(z.number()).optional(),
  labels: z.array(z.string()).optional(),
  // pillars
  pillars: z.array(z.string()).optional(),
  unstableIndex: z.number().int().optional(),
  carries: z.string().optional(),
  // closer
  statement: z.string().optional(),
});
export type DraftScene = z.infer<typeof DraftScene>;

export const ScriptDraft = z.object({
  title: z.string(),
  voiceover: z.string(),
  scenes: z.array(DraftScene),
});
export type ScriptDraft = z.infer<typeof ScriptDraft>;

/**
 * Build a strict Scene from a flat draft scene.
 *
 * Returns null when the draft lacks something the type needs — the caller
 * reports that as a validation problem rather than guessing a default, because
 * a counter with invented numbers is worse than a counter that gets fixed.
 */
export function draftSceneToScene(
  draft: DraftScene,
  id: string,
): Scene | null {
  const base = {
    id,
    durationInFrames: 90,
    anchorPhrase: draft.anchorPhrase,
    headline: draft.headline,
    sub: draft.sub,
    phase: draft.phase,
  };

  const candidate = (() => {
    switch (draft.type) {
      case "hook":
        return { ...base, type: "hook" as const, kicker: draft.kicker };
      case "counter":
        return draft.values?.length
          ? { ...base, type: "counter" as const, values: draft.values.slice(0, 3) }
          : null;
      case "iconGrid":
        return draft.icon && draft.total != null && draft.remaining != null
          ? {
              ...base,
              type: "iconGrid" as const,
              icon: draft.icon,
              total: draft.total,
              remaining: draft.remaining,
            }
          : null;
      case "mapFlow":
        return draft.flows?.length
          ? {
              ...base,
              type: "mapFlow" as const,
              region: draft.region ?? "europe",
              flows: draft.flows,
            }
          : null;
      case "chain":
        return draft.nodes && draft.nodes.length >= 2
          ? {
              ...base,
              type: "chain" as const,
              nodes: draft.nodes,
              breakAt: draft.breakAt ?? 0,
            }
          : null;
      case "split":
        return draft.panels && draft.panels.length >= 2
          ? {
              ...base,
              type: "split" as const,
              left: draft.panels[0],
              right: draft.panels[1],
              connector: draft.connector,
            }
          : null;
      case "chart":
        return draft.series && draft.series.length >= 2 && draft.labels
          ? {
              ...base,
              type: "chart" as const,
              variant: draft.variant ?? "line",
              series: draft.series,
              labels: draft.labels,
            }
          : null;
      case "pillars":
        return draft.pillars && draft.pillars.length >= 2 && draft.carries
          ? {
              ...base,
              type: "pillars" as const,
              pillars: draft.pillars.slice(0, 6),
              unstableIndex: draft.unstableIndex ?? 0,
              carries: draft.carries,
            }
          : null;
      case "closer":
        return draft.statement
          ? { ...base, type: "closer" as const, statement: draft.statement }
          : null;
      case "narrator":
        return { ...base, type: "narrator" as const };
      default:
        return null;
    }
  })();

  if (!candidate) return null;

  const parsed = Scene.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

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
  const scenes = draft.scenes
    .map((scene, i) =>
      draftSceneToScene(scene, `s${String(i + 1).padStart(2, "0")}`),
    )
    .filter((scene): scene is Scene => scene !== null);

  return VideoProject.parse({
    id,
    topic,
    title: draft.title,
    voiceover: draft.voiceover,
    captions: true,
    fps: 30,
    width: 1920,
    height: 1080,
    scenes,
  });
}
