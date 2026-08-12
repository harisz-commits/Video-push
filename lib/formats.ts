import { z } from "zod";
import { COMP_NAME, QUIZ_COMP_NAME, type Format } from "./constants";
import { QuizProject, resolveQuizTiming } from "./quiz";
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

export const AnyProject = z.union([QuizProject, VideoProject]);
export type AnyProject = z.infer<typeof AnyProject>;

/** Which format a stored project belongs to. */
export function formatOf(project: AnyProject): Format {
  return project.kind === "quiz" ? "quiz" : "infographics";
}

export function compositionFor(project: AnyProject): string {
  return project.kind === "quiz" ? QUIZ_COMP_NAME : COMP_NAME;
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
  return project.kind === "quiz"
    ? resolveQuizTiming(project).totalFrames
    : resolveSceneTimings(project).totalFrames;
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
  const words = project.voiceover.trim();
  return `${words ? words.split(/\s+/).length : 0} Wörter · ${project.scenes.length} Szenen`;
}
