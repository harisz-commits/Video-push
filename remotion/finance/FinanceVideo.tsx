import React from "react";
import { AbsoluteFill, interpolate, Sequence, useCurrentFrame } from "remotion";
import type { FinanceScene } from "../../lib/finance";
import {
  resolveStoryTiming,
  storyTakes,
  type StoryProject,
  type StoryTake,
} from "../../lib/story";
import { Soundtrack } from "../story/Soundtrack";
import { ensureFonts } from "../shared/fonts";
import { C } from "../shared/Tokens";
import { FinanceShell } from "./FinanceShell";
import {
  AufteilungScene,
  AussageScene,
  BalkenScene,
  FlussScene,
  FormelScene,
  LinieScene,
  TabelleScene,
  VergleichScene,
  WasserfallScene,
  ZahlScene,
  ZeitstrahlScene,
  ZinseszinsScene,
} from "./scenes";

/**
 * Das Finanz-Format: gesprochener Text über Grafiken, die aus Zahlen entstehen.
 *
 * Dieselbe Uhr wie StoryVideo — eine Zeit je Einstellung, gemessen an der
 * Aufnahme — und derselbe Zusammenfass-Mechanismus: aufeinanderfolgende
 * Einstellungen auf derselben Szene sind EIN Auftritt. Das ist hier wichtiger
 * als dort. Ein Diagramm braucht seine vier Sekunden Aufbau und dann Ruhe;
 * eines, das bei jedem Satz neu aufgebaut würde, wäre unlesbar.
 *
 * Was anders ist als bei StoryVideo: keine Kamerafahrt. Ein Bild, das
 * stillsteht, wirkt tot — ein Diagramm, das wandert, wirkt kaputt. Die
 * Bewegung sitzt hier im Aufbau der Grafik selbst.
 */

/** Frames Überblendung zwischen zwei Szenen. */
const FADE = 8;

const Take: React.FC<{
  take: StoryTake;
  scene: FinanceScene;
  first: boolean;
}> = ({ take, scene, first }) => {
  const frame = useCurrentFrame();

  // Jede Szene außer der ersten beginnt FADE Frames vor ihrem eigentlichen
  // Anfang, damit sie die vorige überlappt. Der Aufbau der Grafik muss vom
  // eigentlichen Anfang aus gerechnet werden, nicht vom Anfang der Sequenz —
  // sonst baut sie sich während der Überblendung schon auf und steht fertig
  // da, wenn der Satz dazu erst anfängt.
  const offset = first ? 0 : FADE;
  const opacity = first
    ? 1
    : interpolate(frame, [0, FADE], [0, 1], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      });

  return (
    <AbsoluteFill style={{ opacity }}>
      <FinanceShell scene={scene} frame={frame - offset}>
        <SceneBody scene={scene} frame={frame - offset} />
      </FinanceShell>
    </AbsoluteFill>
  );
};

/**
 * Welche Grafik zu welchem Typ gehört.
 *
 * Eine Verzweigung statt einer Nachschlagetabelle, weil der Typ hier die
 * diskriminierende Eigenschaft ist: so weiß TypeScript in jedem Zweig, welche
 * Felder die Szene hat, und eine Szene, die um ein Feld erweitert wird, kann
 * an keiner Stelle vergessen werden.
 */
export const SceneBody: React.FC<{ scene: FinanceScene; frame: number }> = ({
  scene,
  frame,
}) => {
  switch (scene.type) {
    case "zahl":
      return <ZahlScene scene={scene} frame={frame} />;
    case "balken":
      return <BalkenScene scene={scene} frame={frame} />;
    case "linie":
      return <LinieScene scene={scene} frame={frame} />;
    case "zinseszins":
      return <ZinseszinsScene scene={scene} frame={frame} />;
    case "vergleich":
      return <VergleichScene scene={scene} frame={frame} />;
    case "wasserfall":
      return <WasserfallScene scene={scene} frame={frame} />;
    case "aufteilung":
      return <AufteilungScene scene={scene} frame={frame} />;
    case "fluss":
      return <FlussScene scene={scene} frame={frame} />;
    case "zeitstrahl":
      return <ZeitstrahlScene scene={scene} frame={frame} />;
    case "tabelle":
      return <TabelleScene scene={scene} frame={frame} />;
    case "formel":
      return <FormelScene scene={scene} frame={frame} />;
    case "aussage":
      return <AussageScene scene={scene} frame={frame} />;
  }
};

export const FinanceVideo: React.FC<{ project: StoryProject }> = ({ project }) => {
  // Aus der Komponente heraus, nicht auf Modulebene: zur Importzeit gibt es
  // Remotions Rendering-Kontext noch nicht. Ohne diesen Aufruf rendert das
  // ganze Format in der Serifen-Ersatzschrift des Browsers — was es tat.
  ensureFonts();
  const timing = resolveStoryTiming(project);
  const takes = storyTakes(timing);
  const byKey = new Map(project.scenes.map((s) => [s.key, s]));

  return (
    <AbsoluteFill style={{ backgroundColor: C.bg }}>
      {takes.map((take, i) => {
        const scene = byKey.get(take.image);
        // Eine Einstellung, deren Szene fehlt, wird übersprungen statt schwarz
        // gezeigt. Der Ton läuft weiter, die vorige Grafik bleibt stehen —
        // das ist die stille Variante des Fehlers, und die richtige: eine
        // schwarze Lücke mitten im Satz sieht nach Defekt aus.
        if (!scene) return null;
        return (
          <Sequence
            key={`${take.id}-${i}`}
            from={Math.max(0, take.from - (i === 0 ? 0 : FADE))}
            durationInFrames={take.durationInFrames + FADE}
            name={`${i + 1}. ${scene.type} — ${take.image}${
              take.shots > 1 ? ` (${take.shots} Sätze)` : ""
            }`}
            layout="none"
          >
            <Take take={take} scene={scene} first={i === 0} />
          </Sequence>
        );
      })}

      <Soundtrack project={project} timing={timing} />
    </AbsoluteFill>
  );
};
