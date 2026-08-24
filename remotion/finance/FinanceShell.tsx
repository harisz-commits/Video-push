import React from "react";
import { AbsoluteFill, useVideoConfig } from "remotion";
import type { FinanceScene } from "../../lib/finance";
import { Figure } from "../shared/character/Figure";
import { poseFor } from "../shared/character/poses";
import { drive, enter } from "../shared/motion";
import { C, FONT, SAFE, TYPE } from "../shared/Tokens";

/**
 * Der Rahmen, in dem jede Finanzszene steht.
 *
 * Überschrift oben, Grafik in der Mitte, Quelle unten links. Immer an
 * derselben Stelle, und das ist der ganze Zweck: bei einer Folge von zwölf
 * Diagrammen ist ein Layout, das je Szene neu entschieden wird, der
 * zuverlässigste Weg, den Zuschauer bei jedem Wechsel neu suchen zu lassen.
 *
 * Die Quellenzeile steht hier und nicht in den einzelnen Szenen, weil sie
 * sonst irgendwann in einer davon fehlen würde. Bei Finanzinhalten ist sie
 * kein Zierat — sie ist der Unterschied zwischen einer Zahl und einer
 * Behauptung.
 */

/** Wie breit die Grafik ist, wenn keine Figur danebensteht. */
export const STAGE = { x: SAFE, width: 1920 - SAFE * 2 };
/** Und wenn doch. Die Figur bekommt rechts ihren eigenen Streifen. */
export const STAGE_WITH_FIGURE = { x: SAFE, width: 1920 - SAFE * 2 - 380 };

/** Wo die Grafik spätestens aufhört. Darunter steht die Quellenzeile. */
export const STAGE_BOTTOM = 1080 - SAFE - 56;

/** Ab welcher Länge eine Überschrift kleiner gesetzt wird. */
const HEADLINE_SHRINK = 58;

/**
 * Wie groß die Überschrift gesetzt wird und wieviele Zeilen sie braucht.
 *
 * Gerechnet und nicht gemessen, weil alles darunter seine Position kennen
 * muss, bevor der Browser umbricht. Eine feste Höhe anzunehmen war der
 * Fehler: eine zweizeilige Überschrift lief in die Unterzeile hinein, und im
 * fertigen Video steht die dann übereinander.
 */
export function headline(scene: FinanceScene): {
  fontSize: number;
  height: number;
} {
  const fontSize = scene.headline.length > HEADLINE_SHRINK ? 58 : 76;
  // Zeichen je Zeile bei dieser Schrift auf 1728 Punkt Breite, abgelesen.
  const perLine = fontSize === 76 ? 34 : 46;
  const lines = Math.max(1, Math.ceil(scene.headline.length / perLine));
  return { fontSize, height: lines * fontSize * 1.06 };
}

/** Wo die Grafik anfängt: unter Überschrift und Unterzeile, nie höher als nötig. */
export function stageTopFor(scene: FinanceScene): number {
  const head = headline(scene);
  const sub = scene.sub ? 62 : 0;
  return Math.round(SAFE + 10 + head.height + sub + 44);
}

/** Und wie hoch sie dann ist. */
export function stageHeightFor(scene: FinanceScene): number {
  return STAGE_BOTTOM - stageTopFor(scene);
}

export type SceneProps<T extends FinanceScene = FinanceScene> = {
  scene: T;
  /** Frames seit dem Beginn DIESER Szene. */
  frame: number;
  /**
   * Wann die einzelnen Sätze dieser Einstellung anfangen, in Frames seit
   * ihrem Beginn. Siehe StoryTake.beats.
   *
   * Damit entsteht eine Grafik in Schritten statt auf einmal. Liegen drei
   * Sätze auf demselben Diagramm, kommt zu jedem Satz ein Teil dazu — bei
   * einem Wasserfall die nächste Stufe, bei einer Tabelle die nächste Zeile,
   * bei einem Verlauf die zweite Kurve. Das ist der Unterschied zwischen
   * einem Bild, über das geredet wird, und einem, das mitredet.
   */
  beats: number[];
};

/**
 * Wieviel einer gestaffelten Liste zum aktuellen Frame schon zu sehen ist.
 *
 * Gibt eine Kommazahl zurück, keinen Index: das letzte Element soll gerade
 * einlaufen und nicht schon dastehen. `count` ist, wieviele Teile die Grafik
 * hat; auf sie werden die Takte verteilt.
 *
 * Ohne Takte — eine Einstellung mit einem einzigen Satz — läuft alles wie
 * bisher gestaffelt in den ersten Frames ein. Ein Diagramm, das zu einem Satz
 * gehört, hat keine Schritte zu machen.
 */
export function revealed(
  frame: number,
  beats: number[],
  count: number,
  fps: number,
): number {
  if (count <= 0) return 0;
  if (beats.length < 2) return count;

  // Die Teile werden auf die Takte verteilt: bei sechs Stufen und drei Sätzen
  // kommen zu jedem Satz zwei Stufen dazu.
  const perBeat = count / beats.length;
  let visible = 0;
  for (const [i, at] of beats.entries()) {
    if (frame < at) break;
    // Innerhalb eines Taktes läuft der Anteil über eine halbe Sekunde ein,
    // damit die Teile nicht im selben Frame erscheinen.
    const into = Math.min(1, (frame - at) / (fps * 0.5));
    visible = perBeat * i + perBeat * into;
  }
  return Math.min(count, visible);
}

export const FinanceShell: React.FC<{
  scene: FinanceScene;
  frame: number;
  children: React.ReactNode;
}> = ({ scene, frame, children }) => {
  const { fps } = useVideoConfig();
  const head = enter(frame, fps);
  const sub = enter(frame, fps, 4);
  const source = "source" in scene ? scene.source : undefined;
  const type = headline(scene);

  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <div
        style={{
          position: "absolute",
          left: SAFE,
          top: SAFE + 10,
          width: 1920 - SAFE * 2,
          ...TYPE.headline,
          fontSize: type.fontSize,
          ...head.style,
          transformOrigin: "left center",
        }}
      >
        {scene.headline}
      </div>

      {scene.sub ? (
        <div
          style={{
            position: "absolute",
            left: SAFE,
            // Unter der Überschrift, wie hoch die auch ausgefallen ist.
            top: SAFE + 10 + type.height + 8,
            width: 1920 - SAFE * 2 - (scene.figure ? 380 : 0),
            ...TYPE.sub,
            ...sub.style,
            transformOrigin: "left center",
          }}
        >
          {scene.sub}
        </div>
      ) : null}

      {children}

      {scene.figure ? <SideFigure action={scene.figure} frame={frame} /> : null}

      {source ? (
        <div
          style={{
            position: "absolute",
            left: SAFE,
            bottom: SAFE - 34,
            fontFamily: FONT.mono,
            fontSize: 19,
            letterSpacing: "0.02em",
            color: C.muted,
            // Später als alles andere, damit sie nicht mit der Aussage um
            // Aufmerksamkeit konkurriert. Sie soll lesbar sein, nicht gelesen
            // werden.
            opacity: drive(frame, fps, 24) * 0.75,
          }}
        >
          Quelle: {source}
        </div>
      ) : null}
    </AbsoluteFill>
  );
};

/**
 * Die Figur am Rand, ohne Lippensynchronität.
 *
 * Das Infographics-Format liest für den Mund die Zeichen-Timestamps; dieses
 * Format speichert stattdessen eine Zeit je Einstellung und wirft die
 * Zeichenzeiten weg. Ein Mund, der zu geratener Sprache auf- und zugeht, ist
 * schlechter als einer, der ruhig bleibt — also bleibt er ruhig, und die
 * Figur lebt von Haltung, Blinzeln und einem langsamen Schwanken.
 */
const BLINK_PERIOD = 118;
const BLINK_FRAMES = 4;

const SideFigure: React.FC<{
  action: NonNullable<FinanceScene["figure"]>;
  frame: number;
}> = ({ action, frame }) => {
  const { fps } = useVideoConfig();
  const appear = enter(frame, fps, 8);
  // Die Geste sitzt nach einer Sekunde und bleibt dann; darunter läuft ein
  // langsames Driften der Arme, damit die Figur im Stehen nicht einfriert.
  const settle = drive(frame, fps, 10, 22);
  const idle = 0.05 + 0.14 * (0.5 + 0.5 * Math.sin(frame / 64));
  const pose = poseFor(action, frame, settle, idle);

  const sinceBlink = frame % BLINK_PERIOD;
  const blink =
    sinceBlink < BLINK_FRAMES
      ? Math.sin((sinceBlink / BLINK_FRAMES) * Math.PI)
      : 0;

  return (
    <div
      style={{
        position: "absolute",
        right: SAFE - 20,
        bottom: SAFE - 20,
        ...appear.style,
        transformOrigin: "bottom right",
      }}
    >
      <Figure
        {...pose}
        blink={blink}
        sway={Math.sin(frame / 50)}
        accent={C.wheat}
        crop="full"
        height={420}
      />
    </div>
  );
};
