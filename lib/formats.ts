import { z } from "zod";
import {
  COMP_NAME,
  QUIZ_COMP_NAME,
  STORY_COMP_NAME,
  type Format,
} from "./constants";
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

/** Which format a stored project belongs to. */
export function formatOf(project: AnyProject): Format {
  if (project.kind === "quiz") return "quiz";
  if (project.kind === "video") return "video";
  return "infographics";
}

export function compositionFor(project: AnyProject): string {
  if (project.kind === "quiz") return QUIZ_COMP_NAME;
  if (project.kind === "video") return STORY_COMP_NAME;
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
  if (project.kind === "video") return resolveStoryTiming(project).totalFrames;
  return resolveSceneTimings(project).totalFrames;
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
  if (!project.audioUrl || !project.alignment) {
    return "Für diesen Render fehlt das Voiceover. Erzeuge zuerst die Stimme — die Szenenzeiten kommen aus den Timestamps.";
  }
  return null;
}

/** A one-line description for the project list, per format. */
export function describeProject(project: AnyProject): string {
  if (project.kind === "quiz") {
    return `${project.questions.length} Fragen`;
  }
  if (project.kind === "video") {
    const words = project.shots
      .reduce((n, s) => n + s.text.trim().split(/\s+/).length, 0);
    const drawn = project.images.filter((i) => i.url).length;
    return `${words} Wörter · ${project.shots.length} Einstellungen · ${drawn}/${project.images.length} Bilder`;
  }
  const words = project.voiceover.trim();
  return `${words ? words.split(/\s+/).length : 0} Wörter · ${project.scenes.length} Szenen`;
}
