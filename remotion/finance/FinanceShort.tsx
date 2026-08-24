import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import type { StoryProject, StoryShort } from "../../lib/story";
import {
  FADE,
  HEIGHT,
  ShortVideo,
  WIDTH,
  type ShortVisual,
} from "../story/StoryShort";
import { ensureFonts } from "../shared/fonts";
import { C } from "../shared/Tokens";
import { FinanceShell } from "./FinanceShell";
import { SceneBody } from "./FinanceVideo";

/**
 * Ein Finanzvideo, hochkant geschnitten.
 *
 * Die Grafik wird nicht neu gebaut, sondern verkleinert. Das ist die
 * Entscheidung, an der hier alles hängt: die zwölf Szenen sind auf 1920×1080
 * ausgemessen — Achsenbreite, Balkenabstand, Schriftgrade, wo die Quellenzeile
 * sitzt —, und ein zweites Layout für hochkant wäre ein zweiter Satz derselben
 * Entscheidungen, der beim ersten Nachjustieren auseinanderläuft.
 *
 * Verkleinert um 1080/1920 wird aus der Bühne ein 1080 breiter und 608 hoher
 * Streifen. In einem 1920 hohen Bild bleiben darüber und darunter je rund 650
 * Punkte — und genau die braucht ein Short: oben der eingebrannte Satz, unten
 * Luft für die Knöpfe des Feeds. Was beim Video-Format ein Verlust ist (ein
 * 16:9-Bild verliert hochkant zwei Drittel seiner Breite), ist hier keiner:
 * das Diagramm bleibt vollständig.
 */

/**
 * Verkleinert auf die INHALTSBREITE, nicht auf die Bildbreite.
 *
 * Die Szenen halten links und rechts je 96 Punkte Rand frei — auf einem
 * Fernseher richtig, hochkant verschenkt. Wird stattdessen auf die 1728
 * Punkte dazwischen skaliert, ist alles elf Prozent größer, und elf Prozent
 * entscheiden hier: eine Achsenbeschriftung von 22 Punkten landet sonst bei
 * zwölf, und zwölf Punkte auf einem Telefon liest niemand.
 */
const SAFE = 96;
/**
 * Der Steg, der hochkant übrig bleibt.
 *
 * Nicht null: ohne ihn klebt die Überschrift links am Bildrand und der letzte
 * Balken rechts. Und nicht die 96 der Vorlage — das wäre auf einem Telefon
 * ein Zehntel der Breite für nichts.
 */
const MARGIN = 28;
const SCALE = (WIDTH - MARGIN * 2) / (1920 - SAFE * 2);
/**
 * Wo der Streifen sitzt.
 *
 * Nicht mittig, sondern im oberen Drittel: darunter stehen die Untertitel,
 * und die stehen tief genug, um die Bedienleiste des Feeds zu überleben. Was
 * darüber frei bleibt, ist die Zone, in der ein Telefon seine eigene Leiste
 * und der Feed den Namen des Kanals zeichnet.
 *
 * Gemessen und nicht geschätzt: ein dreizeiliger Hook reicht von unten bis
 * auf 1.040 hinauf, und dort endete der Streifen vorher genau. Ein vierter
 * Zeilenumbruch hätte in die Quellenzeile geschnitten.
 */
const STRIPE_TOP = 340;

const SceneTake: ShortVisual = ({ take, project, first, elapsed }) => {
  const frame = useCurrentFrame();
  const scene = project.scenes.find((s) => s.key === take.image);
  if (!scene) return null;

  // Wie im langen Film: die Szene beginnt FADE Frames vor ihrem eigentlichen
  // Anfang, damit sie die vorige überlappt — der Aufbau der Grafik muss aber
  // vom eigentlichen Anfang aus gerechnet werden.
  // Minus FADE, weil die Sequenz früher beginnt als die Einstellung; plus
  // elapsed, weil dieselbe Grafik unter dem Hook schon lief.
  const offset = (first ? 0 : FADE) - elapsed;
  const opacity = first
    ? 1
    : interpolate(frame, [0, FADE], [0, 1], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      });

  return (
    <AbsoluteFill style={{ opacity }}>
      <div
        style={{
          position: "absolute",
          // Der Rand der Vorlage wird herausgeschoben und durch den
          // schmaleren Steg ersetzt.
          left: MARGIN - SAFE * SCALE,
          top: STRIPE_TOP,
          width: 1920,
          height: 1080,
          transform: `scale(${SCALE})`,
          transformOrigin: "top left",
        }}
      >
        <FinanceShell scene={scene} frame={frame - offset}>
          <SceneBody scene={scene} frame={frame - offset} />
        </FinanceShell>
      </div>
    </AbsoluteFill>
  );
};

export const FinanceShortVideo: React.FC<{
  project: StoryProject;
  short: StoryShort;
}> = ({ project, short }) => {
  ensureFonts();
  return (
    <AbsoluteFill style={{ backgroundColor: C.bg }}>
      <ShortVideo
        project={project}
        short={short}
        Visual={SceneTake}
        // Unten statt mittig: mittig läge der Hook quer über dem Diagramm.
        hookAlign="bottom"
      />
    </AbsoluteFill>
  );
};

export const FINANCE_SHORT_SIZE = { width: WIDTH, height: HEIGHT };
