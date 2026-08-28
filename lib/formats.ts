import { z } from "zod";
import {
  COMP_NAME,
  FINANCE_COMP_NAME,
  QUIZ_COMP_NAME,
  STORY_COMP_NAME,
  type Format,
} from "./constants";
import { hasDisclaimer } from "./finance";
import { QuizProject, resolveQuizTiming } from "./quiz";
import { StoryProject, resolveStoryTiming, undrawnImages } from "./story";
import { resolveSceneTimings } from "./align";
import { VideoProject } from "./schema";

/**
 * The seam between the formats.
 *
 * Everything downstream of generation — saving, listing, rendering, previewing
 * — has to work for a video whether it is an infographics film or a quiz, and
 * neither of those should have to know the other exists. This is the one place
 * that knows both, so the rest can ask questions like "how long is this" and
 * "which composition renders it" without a chain of type guards.
 */

export const AnyProject = z.union([QuizProject, StoryProject, VideoProject]);
export type AnyProject = z.infer<typeof AnyProject>;

/**
 * Ob dieses Projekt eines der beiden sprachgetakteten Formate ist.
 *
 * Als Wächterfunktion und nicht als zwei Vergleiche im Ausdruck: seit das
 * Video-Format zwei `kind`-Werte hat, engt TypeScript ein
 * `kind === "video" || kind === "finanz"` im Sonst-Zweig einer Kette nicht
 * mehr ein, und der Sonst-Zweig ist genau die Stelle, an der das
 * Infographics-Format steht.
 */
export function isStory(project: AnyProject): project is StoryProject {
  return project.kind === "video" || project.kind === "finanz";
}

/** Which format a stored project belongs to. */
export function formatOf(project: AnyProject): Format {
  if (project.kind === "quiz") return "quiz";
  if (project.kind === "video") return "video";
  if (project.kind === "finanz") return "finanz";
  return "infographics";
}

export function compositionFor(project: AnyProject): string {
  if (project.kind === "quiz") return QUIZ_COMP_NAME;
  if (project.kind === "video") return STORY_COMP_NAME;
  if (project.kind === "finanz") return FINANCE_COMP_NAME;
  return COMP_NAME;
}

/**
 * How many frames the finished video is.
 *
 * The two formats answer this from different places on purpose: a quiz sums
 * fixed beats, an infographics film reads the voice timestamps. That
 * disagreement is the reason they are separate compositions, and it is exactly
 * what this function hides from everyone else.
 */
export function totalFramesOf(project: AnyProject): number {
  if (project.kind === "quiz") return resolveQuizTiming(project).totalFrames;
  if (project.kind === "video" || project.kind === "finanz") {
    return resolveStoryTiming(project).totalFrames;
  }
  return resolveSceneTimings(
    project as Extract<AnyProject, { kind: "infographics" }>,
  ).totalFrames;
}

/**
 * Why this project cannot be rendered yet, or null when it can.
 *
 * An infographics film without audio would render on estimated timings and
 * produce a silent video nobody wants — the most expensive way to discover a
 * missing voiceover. A quiz has no such dependency: its clock does not come
 * from the voice, so it is renderable the moment it has questions, and a
 * voiceover is something it can gain later.
 */
export function renderBlockedReason(project: AnyProject): string | null {
  if (project.kind === "quiz") {
    return project.questions.length > 0
      ? null
      : "Dieses Quiz hat noch keine Fragen.";
  }
  if (project.kind === "finanz") {
    // Anders als beim Video-Format kann hier nichts ungezeichnet sein — eine
    // Szene entsteht beim Rendern aus ihren Zahlen. Bleibt die Stimme, und
    // die fehlt aus demselben Grund wie dort: ohne sie stehen die Wechsel
    // geschätzt.
    if (!project.scenes.length) {
      return "Dieses Finanzvideo hat noch keine Szenen.";
    }
    // Der Hinweis ist kein Wunsch, sondern die Bedingung, unter der dieses
    // Format überhaupt veröffentlicht werden darf. Neue Videos bekommen ihn
    // beim Schreiben; ältere kommen hier vorbei und werden nicht gerendert,
    // bevor er drin ist. Siehe withDisclaimer().
    if (!hasDisclaimer(project)) {
      return "Diesem Finanzvideo fehlt der Hinweis, dass es keine Anlageberatung ist. Setz ihn im Rendern-Feld ein — danach muss die Stimme neu aufgenommen werden, weil ein Satz dazukommt.";
    }
    if (!project.audioUrl || !project.cues?.length) {
      return "Für diesen Render fehlt die Stimme. Ohne sie stehen die Szenenwechsel nur geschätzt — erzeuge zuerst das Voiceover.";
    }
    return null;
  }
  if (project.kind === "video") {
    // Two things can be missing here, and they fail differently. Without the
    // voice the cut is a guess from word counts, which renders but drifts out
    // of sync with itself. Without pictures there is literally nothing on
    // screen — the most expensive way to find out that the drawing step was
    // never run.
    const undrawn = undrawnImages(project).length;
    if (undrawn === project.images.length) {
      return "Für dieses Video ist noch kein einziges Bild gezeichnet. Zeichne zuerst die Bilder.";
    }
    // Cues, not alignment. This format stores one time per shot, and the
    // voice route clears the character alignment when it writes them — two
    // sources of truth that disagree would be worse than one. Checking the
    // field this format no longer uses is what blocked rendering a video whose
    // voice had just been recorded perfectly well.
    if (!project.audioUrl || !project.cues?.length) {
      return "Für diesen Render fehlt die Stimme. Ohne sie stehen die Bildwechsel nur geschätzt — erzeuge zuerst das Voiceover.";
    }
    return null;
  }
  const infographics = project as Extract<AnyProject, { kind: "infographics" }>;
  if (!infographics.audioUrl || !infographics.alignment) {
    return "Für diesen Render fehlt das Voiceover. Erzeuge zuerst die Stimme — die Szenenzeiten kommen aus den Timestamps.";
  }
  return null;
}

/** A one-line description for the project list, per format. */
export function describeProject(project: AnyProject): string {
  if (project.kind === "quiz") {
    return `${project.questions.length} Fragen`;
  }
  if (project.kind === "video" || project.kind === "finanz") {
    const words = project.shots
      .reduce((n, s) => n + s.text.trim().split(/\s+/).length, 0);
    const head = `${words} Wörter · ${project.shots.length} Einstellungen`;
    if (project.kind === "finanz") {
      return `${head} · ${project.scenes.length} Szenen`;
    }
    const drawn = project.images.filter((i) => i.url).length;
    return `${head} · ${drawn}/${project.images.length} Bilder`;
  }
  const infographics = project as Extract<AnyProject, { kind: "infographics" }>;
  const words = infographics.voiceover.trim();
  return `${words ? words.split(/\s+/).length : 0} Wörter · ${infographics.scenes.length} Szenen`;
}
