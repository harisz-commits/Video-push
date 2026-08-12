import { del, list } from "@vercel/blob";
import { AnyProject, describeProject, formatOf } from "./formats";
import { VideoProject } from "./schema";
import { readJson, resolveBlobToken, writeJson } from "./store";

/**
 * Saved projects.
 *
 * Everything expensive in this studio is produced once and then thrown away:
 * a script costs a research pass and several model calls, a voiceover costs
 * characters at ElevenLabs, and both lived only in React state. A reload, a
 * closed tab, a crash — and the way back to a finished script was to generate
 * a different one, because the model does not produce the same text twice.
 *
 * A project is the thing that keeps them. Script, voiceover, audio, alignment
 * and scene edits belong to it, so a session that only lacks the render picks
 * up at the render instead of at the topic.
 */

export type ProjectRender = {
  renderId: string;
  outputUrl?: string;
  sizeBytes?: number;
  at: number;
};

export type ProjectRecord = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  /** Everything the player and the renderer need, exactly as they take it. */
  project: AnyProject;
  /**
   * The facts the script was written from, verbatim.
   *
   * Kept with the project rather than only on the generation job, which is
   * swept after thirty days: a number in a finished video should stay
   * traceable to a source for as long as the video exists.
   */
  research?: string;
  /** The last finished render, so a completed video is not re-rendered. */
  lastRender?: ProjectRender;
};

/** What the project list shows, without shipping every scene to draw a row. */
export type ProjectSummary = {
  id: string;
  title: string;
  topic: string;
  /** Which renderer it belongs to, so the list can be read at a glance. */
  format: "infographics" | "quiz";
  createdAt: number;
  updatedAt: number;
  /** Format-specific one-liner: words and scenes, or a question count. */
  detail: string;
  hasScript: boolean;
  hasAudio: boolean;
  renderUrl?: string;
};

const PREFIX = "projects/";
export const projectPath = (id: string) => `${PREFIX}${id}.json`;

/** Ids are user-visible in nothing, but they are blob keys — keep them tame. */
export const PROJECT_ID = /^[a-zA-Z0-9_-]{6,64}$/;

export function newProjectId(): string {
  return `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export function summarize(record: ProjectRecord): ProjectSummary {
  const p = record.project;
  return {
    id: record.id,
    title: record.title,
    topic: p.topic,
    format: formatOf(p),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    detail: describeProject(p),
    // "Has content" is not "has a project" — a project starts as an empty
    // shell the moment a topic is typed, and saying it holds a script when it
    // holds the seed placeholder would be a lie the list repeats every row.
    hasScript:
      p.kind === "quiz"
        ? p.questions.length > 0
        : p.voiceover.trim().length > 0,
    hasAudio:
      p.kind === "quiz"
        ? Boolean(p.audioUrl)
        : Boolean(p.audioUrl && p.alignment),
    renderUrl: record.lastRender?.outputUrl,
  };
}

export async function readProject(id: string): Promise<ProjectRecord | null> {
  return readJson<ProjectRecord>(projectPath(id));
}

export async function saveProject(record: ProjectRecord): Promise<void> {
  await writeJson(projectPath(record.id), record);
}

export async function deleteProject(id: string): Promise<void> {
  const token = resolveBlobToken()?.value;
  if (!token) return;
  await del(projectPath(id), { token });
}

/**
 * Every saved project, newest first.
 *
 * Each row means fetching its document, because Blob listings carry no
 * content. That is fine at this scale and honest about what it costs; if the
 * list ever grows past a few hundred it wants an index, not a bigger fetch.
 */
export async function listProjects(limit = 100): Promise<ProjectSummary[]> {
  const token = resolveBlobToken()?.value;
  if (!token) return [];

  const page = await list({ prefix: PREFIX, limit, token });
  const records = await Promise.all(
    page.blobs.map((blob) =>
      fetch(`${blob.url}?ts=${Date.now()}`, { cache: "no-store" })
        .then((r) => (r.ok ? (r.json() as Promise<ProjectRecord>) : null))
        .catch(() => null),
    ),
  );

  return records
    .filter((r): r is ProjectRecord => Boolean(r?.id && r.project))
    .map(summarize)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * Scripts that were generated but never became a project.
 *
 * Every generation writes a job document holding the finished script, and for
 * a long time that was the only place a script existed — the studio read it
 * into React state and the document was left to the thirty-day sweep. So the
 * work from before projects existed is not lost, it is merely unreachable:
 * there is no list, and the id was only ever in one browser's localStorage.
 *
 * This finds them, so that history can be adopted rather than regenerated.
 * Jobs that failed or are still running have nothing to adopt and are skipped.
 */
export type ScriptHistoryEntry = {
  jobId: string;
  topic: string;
  title: string;
  at: number;
  words: number;
  scenes: number;
};

export async function listScriptHistory(
  limit = 100,
): Promise<ScriptHistoryEntry[]> {
  const token = resolveBlobToken()?.value;
  if (!token) return [];

  const page = await list({ prefix: "jobs/script/", limit, token });
  const jobs = await Promise.all(
    page.blobs.map((blob) =>
      fetch(`${blob.url}?ts=${Date.now()}`, { cache: "no-store" })
        .then((r) => (r.ok ? (r.json() as Promise<ScriptJobShape>) : null))
        .catch(() => null),
    ),
  );

  const entries: ScriptHistoryEntry[] = [];
  for (const job of jobs) {
    if (!job || job.status !== "done") continue;
    const parsed = VideoProject.safeParse(job.project);
    if (!parsed.success) continue;

    const voiceover = parsed.data.voiceover.trim();
    entries.push({
      jobId: job.jobId,
      topic: job.topic ?? parsed.data.topic,
      title: parsed.data.title || job.topic || "Ohne Titel",
      at: job.updatedAt ?? job.startedAt ?? 0,
      words: voiceover ? voiceover.split(/\s+/).length : 0,
      scenes: parsed.data.scenes.length,
    });
  }

  return entries.sort((a, b) => b.at - a.at);
}

type ScriptJobShape = {
  jobId: string;
  topic?: string;
  status?: string;
  project?: unknown;
  startedAt?: number;
  updatedAt?: number;
};

/**
 * Audio files that a saved project still depends on.
 *
 * The nightly cleanup deletes anything under `audio/` older than thirty days,
 * which was safe when audio outlived nothing. Now a project holds a URL to it,
 * and deleting the file would leave a project that cannot be rendered or
 * played and no way to tell why. Anything a project points at is not rubbish.
 */
export async function audioInUse(): Promise<Set<string>> {
  const inUse = new Set<string>();
  const token = resolveBlobToken()?.value;
  if (!token) return inUse;

  const page = await list({ prefix: PREFIX, limit: 1000, token });
  const records = await Promise.all(
    page.blobs.map((blob) =>
      fetch(`${blob.url}?ts=${Date.now()}`, { cache: "no-store" })
        .then((r) => (r.ok ? (r.json() as Promise<ProjectRecord>) : null))
        .catch(() => null),
    ),
  );

  for (const record of records) {
    const url = record?.project?.audioUrl;
    if (!url) continue;
    // Store the pathname, since that is what a listing gives to compare with.
    try {
      inUse.add(new URL(url).pathname.replace(/^\//, ""));
    } catch {
      // A malformed URL protects nothing; skip it rather than throw.
    }
  }
  return inUse;
}
