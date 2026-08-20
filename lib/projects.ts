import { del, head, list } from "@vercel/blob";
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
  /**
   * Every render ever started for this project.
   *
   * Written when the render starts, not when it finishes, which is the whole
   * point. A finished render used to reach the project only if the browser was
   * still open and still polling at the moment it completed — so a phone put
   * down at 37% produced a video that existed, was paid for, and could not be
   * found by anyone afterwards.
   *
   * Whether one has finished is not stored but asked: the file either exists in
   * Blob storage or it does not, and that answer is true regardless of who was
   * watching. See `reconcileRenders`.
   */
  renders?: ProjectRender[];
};

/** What the project list shows, without shipping every scene to draw a row. */
export type ProjectSummary = {
  id: string;
  title: string;
  topic: string;
  /** Which renderer it belongs to, so the list can be read at a glance. */
  format: "infographics" | "quiz" | "video";
  createdAt: number;
  updatedAt: number;
  /** Format-specific one-liner: words and scenes, or a question count. */
  detail: string;
  hasScript: boolean;
  hasAudio: boolean;
  renderUrl?: string;
  /** Renders started for this project that have no video yet. */
  pendingRenders: number;
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
        : p.kind === "video"
          ? p.shots.length > 0
          : p.voiceover.trim().length > 0,
    hasAudio:
      p.kind === "quiz"
        ? Boolean(p.audioUrl)
        : p.kind === "video"
          // Cues, not alignment — this format stores one time per shot and
          // clears the character alignment when it records. Asking for the
          // field it no longer uses made every finished video report itself
          // as silent, which is the same mistake the render gate made.
          ? Boolean(p.audioUrl && p.cues?.length)
          : Boolean(p.audioUrl && p.alignment),
    // Either source counts. `lastRender` is what the browser used to write
    // when it happened to be watching; `renders` is what the server files
    // regardless. Reading only the first is how a project with a perfectly
    // good video reported having none.
    renderUrl:
      [...(record.renders ?? [])]
        .filter((r) => r.outputUrl)
        .sort((a, b) => b.at - a.at)[0]?.outputUrl ?? record.lastRender?.outputUrl,
    pendingRenders: (record.renders ?? []).filter((r) => !r.outputUrl).length,
  };
}

export async function readProject(id: string): Promise<ProjectRecord | null> {
  return readJson<ProjectRecord>(projectPath(id));
}

/** Where a render's finished video lands. The one place that knows the path. */
export const renderBlobPath = (renderId: string) => `renders/${renderId}.mp4`;

/**
 * Ask the storage which of a project's renders actually finished.
 *
 * The truth about a render is not a status somebody remembered to write down —
 * it is whether the file is there. A render whose watcher walked away still
 * uploaded its video, and this is what finds it again.
 *
 * Returns the record with any newly-discovered videos filled in, and whether
 * anything changed, so the caller can decide whether it is worth a write.
 */
export async function reconcileRenders(
  record: ProjectRecord,
): Promise<{ record: ProjectRecord; changed: boolean }> {
  const token = resolveBlobToken()?.value;
  const pending = (record.renders ?? []).filter((r) => !r.outputUrl);
  if (!token || pending.length === 0) return { record, changed: false };

  const found = await Promise.all(
    pending.map(async (render) => {
      try {
        const meta = await head(renderBlobPath(render.renderId), { token });
        return { ...render, outputUrl: meta.url, sizeBytes: meta.size };
      } catch {
        // Not there. Either still rendering, or it failed and never will be —
        // this cannot tell the two apart, and does not need to.
        return null;
      }
    }),
  );

  const byId = new Map<string, ProjectRender>(
    found
      .filter((r): r is NonNullable<typeof r> => r !== null)
      .map((r) => [r.renderId, r]),
  );
  if (byId.size === 0) return { record, changed: false };

  const renders = (record.renders ?? []).map((r) => byId.get(r.renderId) ?? r);
  const newest = [...renders]
    .filter((r) => r.outputUrl)
    .sort((a, b) => b.at - a.at)[0];

  return {
    record: { ...record, renders, lastRender: newest ?? record.lastRender },
    changed: true,
  };
}

/** Note that a render has been started, so it can be found again later. */
export async function attachRender(
  projectId: string,
  render: ProjectRender,
  /**
   * The project exactly as it was rendered.
   *
   * Saved here, and this is not bookkeeping. Rendering sends the project from
   * the browser's memory while saving it is a separate, silent background
   * request - so the two can disagree, and did: a video was rendered with its
   * voice, downloaded with its voice, and the stored project had no voice at
   * all, because the autosave carrying it had failed without saying so. The
   * next page load read storage and the recording was simply gone. The file
   * still existed; nothing pointed at it any more.
   *
   * A render is the strongest statement anybody makes about a project - it
   * costs real money and produces the deliverable - so what was rendered is
   * what gets stored. Optional, because the quiz and infographics studios call
   * this without one and their own saving is unaffected.
   */
  project?: AnyProject,
): Promise<void> {
  const record = await readProject(projectId);
  if (!record) return;

  // Newest first, and bounded: a project someone has re-rendered thirty times
  // does not need thirty rows, and the old ones are swept from storage anyway.
  const renders = [render, ...(record.renders ?? [])].slice(0, 12);
  await saveProject({
    ...record,
    ...(project ? { project } : {}),
    renders,
    updatedAt: Date.now(),
  });
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

  const live = records.filter((r): r is ProjectRecord => Boolean(r?.id && r.project));

  // Reconciled here too, not only when a project is opened: "has a finished
  // video" is the one thing someone scans this list for after walking away
  // from a render, and it would be perverse to make them open each project to
  // find out. Discoveries are written back so the next read is free.
  const reconciled = await Promise.all(
    live.map(async (record) => {
      const { record: next, changed } = await reconcileRenders(record);
      if (changed) await saveProject(next).catch(() => undefined);
      return next;
    }),
  );

  return reconciled.map(summarize).sort((a, b) => b.updatedAt - a.updatedAt);
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
  return referencedFiles();
}

/**
 * Everything under a swept prefix that a saved project still needs.
 *
 * Age stopped being a good enough reason to delete once projects started
 * outliving the session that made them: a saved project points at its
 * voiceover and at every video it has produced, and sweeping either leaves a
 * project that will not play, will not render, and cannot explain why.
 */
/**
 * Every saved project, read raw.
 *
 * No render reconciliation and no writing back, unlike listProjects() - this
 * is for jobs that only want to look at what is stored. Split out of
 * referencedFiles(), which was already doing exactly this walk privately.
 */
export async function readAllProjects(limit = 1000): Promise<ProjectRecord[]> {
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
  return records.filter((r): r is ProjectRecord => Boolean(r?.id && r.project));
}

async function referencedFiles(): Promise<Set<string>> {
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

  const keep = (url: string | undefined) => {
    if (!url) return;
    // Store the pathname, since that is what a listing gives to compare with.
    try {
      inUse.add(new URL(url).pathname.replace(/^\//, ""));
    } catch {
      // A malformed URL protects nothing; skip it rather than throw.
    }
  };

  for (const record of records) {
    if (!record) continue;
    keep(record.project?.audioUrl);
    for (const render of record.renders ?? []) keep(render.outputUrl);
    keep(record.lastRender?.outputUrl);
  }
  return inUse;
}
