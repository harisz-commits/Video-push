import React from "react";
import { Composition } from "remotion";
import europa from "../data/europa.json";
import quizFlaggen from "../data/quiz-flaggen.json";
import { resolveSceneTimings } from "../lib/align";
import type { Scene, VideoProject } from "../lib/schema";
import { VideoProject as VideoProjectSchema } from "../lib/schema";
import { Video } from "./Video";

export {
  COMP_NAME,
  QUIZ_COMP_NAME,
  STORY_COMP_NAME,
  STORY_SHORT_COMP_NAME,
} from "../lib/constants";
import {
  COMP_NAME,
  QUIZ_COMP_NAME,
  STORY_COMP_NAME,
  STORY_SHORT_COMP_NAME,
} from "../lib/constants";
import {
  StoryProject as StoryProjectSchema,
  resolveStoryTiming,
  resolveShortTiming,
} from "../lib/story";
import { StoryVideo } from "./story/StoryVideo";
import { StoryShortVideo } from "./story/StoryShort";
import { QuizProject as QuizProjectSchema, resolveQuizTiming } from "../lib/quiz";
import { QuizVideo } from "./quiz/QuizVideo";

const seed: VideoProject = VideoProjectSchema.parse(europa);

/**
 * A seed for the video format, in code rather than in data/.
 *
 * Remotion needs defaultProps to open a composition at all, and the honest
 * default for this format is a film with no pictures yet: that is what a
 * project looks like between the script being written and the drawing being
 * paid for, and it is the state most worth being able to open.
 */
const storySeed = StoryProjectSchema.parse({
  kind: "video",
  id: "story-seed",
  topic: "Wie die Ägypter die Hitze überlebt haben",
  title: "Wie die Ägypter die Hitze überlebt haben",
  style: {
    name: "Sand und Indigo, Siebdruck",
    directive:
      "Flat screen-print illustration on warm sand paper. Limited palette of sand, ochre, burnt red and deep indigo shadows. Visible fine grain, no gradients. Confident dark outlines, flat fills. Side-on or slightly elevated views with calm horizons and generous empty space. People only as reduced modern stick figures without facial features.",
    palette: ["#E8D5B0", "#C97B3C", "#8C2F1E", "#2A3557"],
  },
  images: [
    {
      key: "lehmziegelhaus-von-der-seite",
      name: "Lehmziegelhaus von der Seite",
      prompt:
        "A mud brick house seen from the side, thick walls, small high windows, a low doorway, desert ground",
    },
  ],
  shots: [
    { id: "s1", text: "Der Sand speichert die Hitze des Tages.", image: "lehmziegelhaus-von-der-seite", motion: "in" },
  ],
});


/**
 * Duration comes from the data, never from a constant. With audio attached it
 * is the last timestamp plus the tail; without audio it is an estimate from the
 * word count so the Player still has something to scrub.
 */
function metadataFor(project: VideoProject) {
  const timing = resolveSceneTimings(project);
  return {
    durationInFrames: Math.max(1, timing.totalFrames),
    fps: project.fps,
    width: project.width,
    height: project.height,
  };
}

export const RemotionRoot: React.FC = () => (
  <>
    <Composition
      id={COMP_NAME}
      component={Video as React.FC<Record<string, unknown>>}
      durationInFrames={metadataFor(seed).durationInFrames}
      fps={seed.fps}
      width={seed.width}
      height={seed.height}
      defaultProps={{ project: seed } as unknown as Record<string, unknown>}
      calculateMetadata={({ props }) => {
        const parsed = VideoProjectSchema.parse(
          (props as { project: unknown }).project,
        );
        return metadataFor(parsed);
      }}
    />

    {/*
      The quiz format. Its length is a sum of fixed beats rather than a
      function of an audio track, which is the whole reason it can guarantee a
      pace: nothing about how long a question is shown depends on how long
      somebody took to say it.
    */}
    <Composition
      id={QUIZ_COMP_NAME}
      component={QuizVideo as React.FC<Record<string, unknown>>}
      durationInFrames={resolveQuizTiming(QuizProjectSchema.parse(quizFlaggen)).totalFrames}
      fps={30}
      width={1920}
      height={1080}
      defaultProps={
        { project: QuizProjectSchema.parse(quizFlaggen) } as unknown as Record<string, unknown>
      }
      calculateMetadata={({ props }) => {
        const parsed = QuizProjectSchema.parse(
          (props as { project: unknown }).project,
        );
        return {
          durationInFrames: resolveQuizTiming(parsed).totalFrames,
          fps: parsed.fps,
          width: parsed.width,
          height: parsed.height,
        };
      }}
    />

    {/*
      A vertical cut of a video. Takes the film it belongs to plus one short,
      because a short is a pair of indices into that film rather than a thing
      of its own - see StoryShort in lib/story.ts.
    */}
    <Composition
      id={STORY_SHORT_COMP_NAME}
      component={StoryShortVideo as unknown as React.FC<Record<string, unknown>>}
      durationInFrames={90}
      fps={30}
      width={1080}
      height={1920}
      defaultProps={
        {
          project: storySeed,
          short: {
            id: "seed",
            title: "Beispiel",
            hook: "Ein Satz, der neugierig macht.",
            from: 0,
            to: 0,
          },
        } as unknown as Record<string, unknown>
      }
      calculateMetadata={({ props }) => {
        const parsed = StoryProjectSchema.parse(
          (props as { project: unknown }).project,
        );
        const short = (props as { short: Parameters<typeof resolveShortTiming>[1] })
          .short;
        return {
          durationInFrames: Math.max(
            1,
            resolveShortTiming(parsed, short).totalFrames,
          ),
          fps: parsed.fps,
          width: 1080,
          height: 1920,
        };
      }}
    />

    {/*
      The video format. Timed by the voice like the infographics film, but it
      needs no anchor phrases: it wrote its own cut, so every picture's offset
      into the narration is known by construction.
    */}
    <Composition
      id={STORY_COMP_NAME}
      component={StoryVideo as React.FC<Record<string, unknown>>}
      durationInFrames={resolveStoryTiming(storySeed).totalFrames}
      fps={30}
      width={1920}
      height={1080}
      defaultProps={
        { project: storySeed } as unknown as Record<string, unknown>
      }
      calculateMetadata={({ props }) => {
        const parsed = StoryProjectSchema.parse(
          (props as { project: unknown }).project,
        );
        return {
          durationInFrames: resolveStoryTiming(parsed).totalFrames,
          fps: parsed.fps,
          width: parsed.width,
          height: parsed.height,
        };
      }}
    />

    {/*
      One composition per scene type, so every scene can be opened, scrubbed
      and tweaked on its own in Remotion Studio without rendering the whole
      film. These are development harnesses; the studio UI never uses them.
    */}
    {SCENE_PROBES.map((probe) => (
      <Composition
        key={probe.id}
        id={`Scene-${probe.id}`}
        component={Video as React.FC<Record<string, unknown>>}
        durationInFrames={150}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={
          { project: probe.project } as unknown as Record<string, unknown>
        }
      />
    ))}
  </>
);

/** Build a single-scene project around one scene, reusing the seed's voiceover. */
function probeProject(id: string, scene: Scene): VideoProject {
  return VideoProjectSchema.parse({
    ...seed,
    id: `probe-${id}`,
    audioUrl: undefined,
    alignment: undefined,
    captions: false,
    scenes: [scene],
  });
}

const base = { id: "probe", durationInFrames: 150, phase: "crisis" } as const;

const SCENE_PROBES: { id: string; project: VideoProject }[] = [
  {
    id: "Hook",
    project: probeProject("hook", {
      ...base,
      type: "hook",
      kicker: "Kicker",
      headline: "EUROPA GEHT DAS ESSEN AUS",
      sub: "Untertitel in Inter Tight.",
    }),
  },
  {
    id: "Counter",
    project: probeProject("counter", {
      ...base,
      type: "counter",
      headline: "BETRIEBE IN DER EU",
      values: [
        { label: "2005", value: 14.5, suffix: "Mio." },
        { label: "heute", value: 9, suffix: "Mio." },
      ],
    }),
  },
  {
    id: "IconGrid",
    project: probeProject("iconGrid", {
      ...base,
      type: "iconGrid",
      headline: "HÖFE VERSCHWINDEN",
      sub: "Betriebe",
      icon: "barn",
      total: 40,
      remaining: 25,
    }),
  },
  {
    id: "MapFlow",
    project: probeProject("mapFlow", {
      ...base,
      type: "mapFlow",
      headline: "WOHER DAS FUTTER KOMMT",
      region: "europe",
      flows: [
        { from: "Suedamerika", to: "Niederlande", label: "Soja" },
        { from: "Russland", to: "Deutschland", label: "Gas" },
      ],
    }),
  },
  {
    id: "Chain",
    project: probeProject("chain", {
      ...base,
      type: "chain",
      headline: "KEIN GAS, KEIN DÜNGER",
      nodes: [
        { icon: "flame", label: "Erdgas" },
        { icon: "factory", label: "Werk" },
        { icon: "fertilizer", label: "Dünger" },
        { icon: "wheat", label: "Ernte" },
      ],
      breakAt: 1,
    }),
  },
  {
    id: "SplitCompare",
    project: probeProject("split", {
      ...base,
      type: "split",
      headline: "DEUTSCHES SCHNITZEL, FREMDER ACKER",
      left: { icon: "barn", label: "STALL IN EUROPA" },
      right: { icon: "wheat", label: "FUTTER IN SÜDAMERIKA" },
      connector: "ship",
    }),
  },
  {
    id: "DataChart",
    project: probeProject("chart", {
      ...base,
      type: "chart",
      headline: "OLIVENÖL, PREIS JE LITER",
      variant: "line",
      series: [3.9, 4.2, 5.6, 8.1, 9.4],
      labels: ["2020", "2021", "2022", "2023", "2024"],
      unit: "EUR",
    }),
  },
  {
    id: "Pillars",
    project: probeProject("pillars", {
      ...base,
      type: "pillars",
      headline: "VIER SÄULEN. EINE OHNE ERSATZ.",
      pillars: ["Boden", "Wissen", "Energie", "Handel"],
      unstableIndex: 0,
      carries: "EUROPAS ERNÄHRUNG",
    }),
  },
  {
    id: "Closer",
    project: probeProject("closer", {
      ...base,
      type: "closer",
      headline: "Kein Nahrungsmittelproblem. Ein Zeitproblem.",
      statement: "Das übernächste Regal wird eine Entscheidung gewesen sein.",
    }),
  },
];
