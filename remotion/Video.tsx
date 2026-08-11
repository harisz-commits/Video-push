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
import { Stage } from "./scenes/Stage";
import { ensureFonts } from "./shared/fonts";
import { ProjectProvider, useProject } from "./shared/ProjectContext";
import { portalFor, type Portal } from "./shared/portal";
import { ACCENT, SceneShell } from "./shared/SceneShell";
import { Cue, SFX_CUE, Soundtrack } from "./shared/Sound";
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
  // cross-fade in the film, and the music bed turns with it.
  const turnIndex = timing.scenes.findIndex(
    (s, i) => s.phase === "solution" && (i === 0 || timing.scenes[i - 1].phase !== "solution"),
  );

  return (
    <AbsoluteFill style={{ backgroundColor: C.bg }}>
      {project.audioUrl ? <Audio src={project.audioUrl} /> : null}

      <Soundtrack
        totalFrames={timing.totalFrames}
        turnFrame={turnIndex >= 0 ? timing.scenes[turnIndex].from : -1}
      />

      {timing.scenes.map((scene, i) => {
        // Two consecutive scenes must agree on the object between them: this
        // one closes into its own portal, the next opens out of the same one.
        const previous = timing.scenes[i - 1];
        return (
          <Sequence
            key={scene.id}
            from={scene.from}
            durationInFrames={scene.durationInFrames}
            name={`${String(i + 1).padStart(2, "0")} ${scene.type}`}
          >
            <SceneFrame
              scene={scene}
              index={i}
              isPhaseTurn={i === turnIndex}
              exitPortal={portalFor(
                scene.type,
                i,
                ACCENT[scene.phase ?? "crisis"],
              )}
              enterPortal={portalFor(
                previous?.type ?? scene.type,
                i - 1,
                ACCENT[previous?.phase ?? scene.phase ?? "crisis"],
              )}
            />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};

const SceneFrame: React.FC<{
  scene: ResolvedScene;
  index: number;
  isPhaseTurn: boolean;
  exitPortal: Portal;
  enterPortal: Portal;
}> = ({ scene, index, isPhaseTurn, exitPortal, enterPortal }) => {
  const frame = useCurrentFrame();
  const phase = scene.phase ?? "crisis";
  const accent = ACCENT[phase];

  return (
    <SceneShell
      from={scene.from}
      durationInFrames={scene.durationInFrames}
      index={index}
      phase={phase}
      isPhaseTurn={isPhaseTurn}
      vignette={scene.type === "hook" || scene.type === "closer"}
      exitPortal={exitPortal}
      enterPortal={enterPortal}
    >
      {renderScene(scene, frame, scene.from + frame, accent)}

      {/*
        The sound of the cut itself. Every scene gets movement on arrival; the
        turn from crisis to solution gets the riser instead, because it is the
        one cut in the film that is supposed to be noticed.
      */}
      {isPhaseTurn ? (
        <Cue name="riser" at={0} />
      ) : (
        <Cue name={index === 0 ? "transition" : "swoosh"} at={0} />
      )}

      {/* Text arriving. Every scene's headline enters on the same curve, so
          the pop belongs here rather than in nine separate components. */}
      {scene.headline ? <Cue name="pop" at={3} /> : null}

      {/*
        And the sound of what the passage is about, which only the script knows:
        a till for money, a glitch for danger. Placed a beat after the cut so it
        reads as a separate event rather than part of the transition.
      */}
      {scene.sfx ? <Cue name={SFX_CUE[scene.sfx]} at={8} /> : null}
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
    case "stage":
      return <Stage scene={s} frame={frame} accent={accent} />;
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
