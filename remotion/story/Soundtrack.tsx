import React from "react";
import { Audio, Sequence } from "remotion";
import type { StoryProject, StorySound, StoryTiming } from "../../lib/story";

/**
 * Klangteppiche, Akzente und die Stimme — für beide sprachgetakteten Formate.
 *
 * Herausgezogen, als das Finanz-Format dazukam. Der Aufbau ist in beiden
 * derselbe und war es schon vorher; zweimal dieselben sechzig Zeilen hätten
 * bedeutet, dass die nächste Korrektur am Ton in einem der beiden Formate
 * vergessen wird. Genau so ist in diesem Projekt schon einmal der ganze
 * Klang aus jedem Render verschwunden.
 */
export const Soundtrack: React.FC<{
  project: StoryProject;
  timing: StoryTiming;
}> = ({ project, timing }) => {
  const byKey = new Map((project.sounds ?? []).map((s) => [s.key, s]));

  /**
   * Aufeinanderfolgende Einstellungen mit demselben Teppich werden EIN
   * Abspielen.
   *
   * Die Gruppierung ist der Punkt: neun Einstellungen, die denselben Wind
   * nennen, sind ein Wind, der weiterläuft — nicht neun, die jedesmal von
   * vorn anfangen.
   */
  const beds: { sound: StorySound; from: number; durationInFrames: number }[] = [];
  for (const shot of timing.shots) {
    const sound = shot.ambience ? byKey.get(shot.ambience) : undefined;
    if (!sound?.url) continue;
    const open = beds[beds.length - 1];
    if (
      open &&
      open.sound.key === sound.key &&
      open.from + open.durationInFrames === shot.from
    ) {
      open.durationInFrames += shot.durationInFrames;
    } else {
      beds.push({
        sound,
        from: shot.from,
        durationInFrames: shot.durationInFrames,
      });
    }
  }

  const accents: { sound: StorySound; from: number; durationInFrames: number }[] = [];
  for (const shot of timing.shots) {
    const sound = shot.accent ? byKey.get(shot.accent) : undefined;
    if (!sound?.url) continue;
    accents.push({
      sound,
      from: shot.from,
      // So lang wie die Datei ist. Ein Schlag, der über das Ende hinausragte,
      // würde nichts verlängern, sondern mitten im Ausklang abgeschnitten.
      durationInFrames: Math.max(
        1,
        Math.round((sound.audioSeconds ?? sound.seconds) * project.fps),
      ),
    });
  }

  return (
    <>
      {/* Vor der Sprecherstimme, damit die im Mix obenauf sitzt. */}
      {beds.map((bed, i) => (
        <Sequence
          key={`bed-${i}`}
          from={bed.from}
          durationInFrames={bed.durationInFrames}
          name={`≈ ${bed.sound.key}`}
          layout="none"
        >
          {/* Zehn Sekunden Wind unter zwei Minuten Film: er muss wiederkommen,
              und die Schleife ist unhörbar, weil das Material keinen Takt hat,
              aus dem es fallen könnte. */}
          <Audio src={bed.sound.url!} volume={project.soundLevel} loop />
        </Sequence>
      ))}

      {accents.map((accent, i) => (
        <Sequence
          key={`accent-${i}`}
          from={accent.from}
          durationInFrames={accent.durationInFrames}
          name={`! ${accent.sound.key}`}
          layout="none"
        >
          {/* Lauter als die Teppiche — sie sollen auffallen. */}
          <Audio
            src={accent.sound.url!}
            volume={Math.min(1, project.soundLevel * 2.4)}
          />
        </Sequence>
      ))}

      {project.audioUrl ? <Audio src={project.audioUrl} /> : null}
    </>
  );
};
