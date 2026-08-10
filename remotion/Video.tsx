"use client";

import React from "react";
import { AbsoluteFill, Audio, Sequence, useCurrentFrame } from "remotion";
import type { ResolvedScene } from "../lib/align";
import type { Scene, VideoProject } from "../lib/schema";
import { Chain } from "./scenes/Chain";
import { Closer } from "./scenes/Closer";
import { Counter } from "./scenes/Counter";
import { DataChart } from "./scenes/DataChart";
import { Hook } from "./scenes/Hook";
import { IconGrid } from "./scenes/IconGrid";
import { MapFlow } from "./scenes/MapFlow";
import { Narrator } from "./scenes/Narrator";
import { Pillars } from "./scenes/Pillars";
import { SplitCompare } from "./scenes/SplitCompare";
import { ensureFonts } from "./shared/fonts";
import { ProjectProvider, useProject } from "./shared/ProjectContext";
import { ACCENT, SceneShell } from "./shared/SceneShell";
import { C } from "./shared/Tokens";

/**
 * The mapper: a VideoProject in, a film out.
 *
 * Adding a new scene type means adding a component and one case below — see
 * the "Adding a scene type" section of the README.
 */
export const Video: React.FC<{ project: VideoProject }> = ({ project }) => {
  // Inside the component: at module scope Remotion's rendering context does
  // not exist yet, and the font registration resolves against the wrong root.
  ensureFonts();
  return (
    <ProjectProvider project={project}>
      <Timeline />
    </ProjectProvider>
  );
};

const Timeline: React.FC = () => {
  const { project, timing } = useProject();

  // The first scene that flips to the solution phase gets the only
  // cross-fade in the film; every other cut is hard.
  const turnIndex = timing.scenes.findIndex(
    (s, i) => s.phase === "solution" && (i === 0 || timing.scenes[i - 1].phase !== "solution"),
  );

  return (
    <AbsoluteFill style={{ backgroundColor: C.bg }}>
      {project.audioUrl ? <Audio src={project.audioUrl} /> : null}

      {timing.scenes.map((scene, i) => (
        <Sequence
          key={scene.id}
          from={scene.from}
          durationInFrames={scene.durationInFrames}
          name={`${String(i + 1).padStart(2, "0")} ${scene.type}`}
        >
          <SceneFrame scene={scene} isPhaseTurn={i === turnIndex} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};

const SceneFrame: React.FC<{
  scene: ResolvedScene;
  isPhaseTurn: boolean;
}> = ({ scene, isPhaseTurn }) => {
  const frame = useCurrentFrame();
  const phase = scene.phase ?? "crisis";
  const accent = ACCENT[phase];

  return (
    <SceneShell
      from={scene.from}
      phase={phase}
      isPhaseTurn={isPhaseTurn}
      vignette={scene.type === "hook" || scene.type === "closer"}
    >
      {renderScene(scene, frame, scene.from + frame, accent)}
    </SceneShell>
  );
};

function renderScene(
  scene: ResolvedScene,
  frame: number,
  absoluteFrame: number,
  accent: string,
): React.ReactNode {
  // `scene` carries the resolved timing fields on top of the Scene union;
  // narrowing on `type` still works because the discriminant is untouched.
  const s = scene as Scene & { durationInFrames: number };

  switch (s.type) {
    case "hook":
      return <Hook scene={s} frame={frame} accent={accent} />;
    case "counter":
      return <Counter scene={s} frame={frame} accent={accent} />;
    case "iconGrid":
      return <IconGrid scene={s} frame={frame} accent={accent} />;
    case "mapFlow":
      return <MapFlow scene={s} frame={frame} accent={accent} />;
    case "chain":
      return <Chain scene={s} frame={frame} accent={accent} />;
    case "split":
      return <SplitCompare scene={s} frame={frame} accent={accent} />;
    case "chart":
      return <DataChart scene={s} frame={frame} accent={accent} />;
    case "pillars":
      return <Pillars scene={s} frame={frame} accent={accent} />;
    case "narrator":
      return (
        <Narrator
          scene={s}
          frame={frame}
          absoluteFrame={absoluteFrame}
          accent={accent}
        />
      );
    case "closer":
      return (
        <Closer
          scene={s}
          frame={frame}
          accent={accent}
          durationInFrames={s.durationInFrames}
        />
      );
    default: {
      // Exhaustiveness guard: a new scene type fails to compile until it is
      // wired up here.
      const never: never = s;
      return never;
    }
  }
}
