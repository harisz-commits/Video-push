import { head, put } from "@vercel/blob";

/**
 * Small JSON documents in Vercel Blob — render progress and the daily spend
 * counters. Deliberately not a database: the studio is single-tenant and this
 * keeps the deployment to one Vercel project with one storage add-on.
 */

/** Raised when the Blob store was never attached — a setup problem, not a miss. */
export class BlobNotConfiguredError extends Error {
  constructor() {
    super(
      "BLOB_READ_WRITE_TOKEN fehlt. Auf vercel.com unter Storage einen Blob-Store anlegen, mit diesem Projekt verbinden und neu deployen.",
    );
    this.name = "BlobNotConfiguredError";
  }
}

/**
 * Find the Blob token whatever Vercel decided to call it.
 *
 * Connecting a store normally sets BLOB_READ_WRITE_TOKEN, but when a prefix is
 * configured — or a second store is attached — the name becomes
 * <PREFIX>_BLOB_READ_WRITE_TOKEN. The dashboard reports "Connected" either
 * way, so hardcoding the plain name turns a working store into a missing one.
 */
export function resolveBlobToken(): { name: string; value: string } | null {
  const direct = process.env.BLOB_READ_WRITE_TOKEN;
  if (direct) return { name: "BLOB_READ_WRITE_TOKEN", value: direct };

  // A second store gets a prefix derived from its name, and the prefix simply
  // replaces the leading BLOB — a store called video-push-blob-public yields
  // VIDEO_PUSH_BLOB_PUBLIC_READ_WRITE_TOKEN, which does not end in
  // BLOB_READ_WRITE_TOKEN. Matching the READ_WRITE_TOKEN suffix catches both
  // shapes; nothing else in this project uses that suffix.
  for (const [name, value] of Object.entries(process.env)) {
    if (value && name.endsWith("READ_WRITE_TOKEN")) {
      return { name, value };
    }
  }
  return null;
}

/** Names of every Blob-ish variable present, for diagnostics. Names only. */
export function blobEnvNames(): string[] {
  return Object.keys(process.env)
    .filter((name) => name.includes("BLOB"))
    .sort();
}

export function hasBlobToken(): boolean {
  return resolveBlobToken() !== null;
}

/**
 * Access mode of the connected store, which every call has to match — the API
 * rejects a public write to a private store outright.
 *
 * Defaults to public because the media has to be readable by URL: the browser
 * plays the voiceover, the sandbox fetches it while rendering, and the finished
 * MP4 is downloaded directly. A private store keeps those objects behind
 * authentication and breaks all three.
 */
export const BLOB_ACCESS: "public" | "private" =
  process.env.BLOB_ACCESS === "private" ? "private" : "public";

function token(): string {
  const found = resolveBlobToken();
  if (!found) throw new BlobNotConfiguredError();
  return found.value;
}

export async function writeJson(
  pathname: string,
  data: unknown,
): Promise<string> {
  const { url } = await put(pathname, JSON.stringify(data), {
    access: BLOB_ACCESS,
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
    // 60s is the floor the Blob API allows; readJson defeats it with a
    // cache-busting query string, so a poller still sees fresh state.
    cacheControlMaxAge: 60,
    token: token(),
  });
  return url;
}

export async function readJson<T>(pathname: string): Promise<T | null> {
  // Resolved before the try on purpose. Inside it, a missing token would be
  // caught by the same handler that means "no such blob", so a store that was
  // never attached would look exactly like a document that does not exist yet
  // — and the caller would happily carry on until the next write threw.
  const blobToken = token();

  let url: string;
  try {
    const meta = await head(pathname, { token: blobToken });
    url = meta.url;
  } catch {
    // Genuinely absent, which is normal on the first read of a key.
    return null;
  }

  // The unique query string means the CDN can never serve us a stale copy of a
  // progress document that is being overwritten every second.
  const response = await fetch(`${url}?ts=${Date.now()}`, {
    cache: "no-store",
  });
  if (!response.ok) return null;

  return (await response.json()) as T;
}

export async function writeBinary(
  pathname: string,
  data: Buffer,
  contentType: string,
): Promise<string> {
  const { url } = await put(pathname, data, {
    access: BLOB_ACCESS,
    contentType,
    addRandomSuffix: false,
    allowOverwrite: true,
    token: token(),
  });
  return url;
}

/**
 * The handle on a detached render.
 *
 * Deliberately not a progress snapshot: the sandbox owns the truth about how
 * far along it is, and a copy written by a function that may be killed at any
 * moment is exactly how a render came to sit at "38%, rendering" forever.
 * /api/progress asks the sandbox instead.
 */
export type RenderJob = {
  renderId: string;
  sandboxId: string;
  cmdId: string;
  totalFrames: number;
  startedAt: number;
  /** How long the sandbox was granted, so progress can say when it ran out. */
  lifetimeMs: number;
};

/** What /api/progress reports to the studio. */
export type RenderProgress = {
  renderId: string;
  status: "queued" | "rendering" | "done" | "error";
  progress: number;
  phase: string;
  outputUrl?: string;
  sizeBytes?: number;
  error?: string;
  startedAt: number;
  updatedAt: number;
};

export const progressPath = (renderId: string) =>
  `renders/${renderId}/progress.json`;

/**
 * A background job the browser does not have to wait for.
 *
 * Script generation takes minutes, and a request held open that long dies with
 * the tab — closing the laptop should not cost a script. The route starts the
 * work, writes its state here, and hands back an id the studio polls, exactly
 * as rendering already worked.
 */
export type ScriptJob = {
  jobId: string;
  topic: string;
  status: "running" | "done" | "error";
  /** Which half of the work is happening, for the studio to show. */
  step?: string;
  /** Present once status is "done". Shape validated by VideoProject. */
  project?: unknown;
  /**
   * What the research step actually looked up, verbatim.
   *
   * Kept on the job so the numbers in a finished video can be traced back to a
   * source rather than taken on trust. A fact nobody can check is the same
   * problem as an invented one.
   */
  research?: string;
  /**
   * Authorises the handover from the research phase to the writing one.
   *
   * Minted when the job is created and never sent to a client — the poller
   * strips it. Without it, /api/script/continue would let anyone re-run the
   * expensive half of a job that is not theirs.
   */
  continueToken?: string;
  error?: string;
  startedAt: number;
  updatedAt: number;
};

export const scriptJobPath = (jobId: string) => `jobs/script/${jobId}.json`;

/**
 * A voiceover being synthesised, for the same reason a script is.
 *
 * Synthesis is not slow enough to need a job for its own sake — it is the
 * browser that makes one necessary. A request held open across a tab going to
 * the background gets aborted by the browser, and the studio then reports "no
 * connection to the server" for a server that is working perfectly. Worse, the
 * work had already been paid for at ElevenLabs by then and there was no way
 * back to it.
 *
 * Starting the work and asking after it are two short requests, and neither
 * cares whether the tab is in front.
 */
export type VoiceJob = {
  jobId: string;
  projectId: string;
  status: "running" | "done" | "error";
  audioUrl?: string;
  alignment?: unknown;
  characterCount?: number;
  error?: string;
  startedAt: number;
  updatedAt: number;
};

export const voiceJobPath = (jobId: string) => `jobs/voice/${jobId}.json`;

/** A quiz being written. Same background-job shape as the other two. */
export type QuizJob = {
  jobId: string;
  topic: string;
  status: "running" | "done" | "error";
  step?: string;
  project?: unknown;
  error?: string;
  /**
   * Something went wrong that did not cost the quiz.
   *
   * Narration is the case: it runs after the questions are written and paid
   * for, so a voice failure must not discard them. The job is done, the
   * warning says what is missing.
   */
  warning?: string;
  /** What the run actually cost, measured from the provider's token counts. */
  cost?: {
    model: string;
    label: string;
    inputTokens: number;
    outputTokens: number;
    cents: number;
  };
  /**
   * How many earlier questions this run was told to avoid.
   *
   * Reported because the memory is otherwise invisible: a quiz with fresh
   * questions and a quiz that got lucky look identical, and this number is the
   * only thing that says which one happened.
   */
  avoided?: number;
  startedAt: number;
  updatedAt: number;
};

export const quizJobPath = (jobId: string) => `jobs/quiz/${jobId}.json`;

/**
 * Writing a video: the script and the picture list, before anything is drawn.
 *
 * Separate from the drawing job on purpose. Writing costs a fraction of a cent
 * and drawing costs dollars, so the two are different jobs with different
 * buttons — a script that comes back wrong should cost nothing to throw away.
 */
export type StoryJob = {
  jobId: string;
  topic: string;
  status: "running" | "done" | "error";
  step?: string;
  project?: unknown;
  error?: string;
  warning?: string;
  cost?: {
    model: string;
    label: string;
    inputTokens: number;
    outputTokens: number;
    cents: number;
  };
  startedAt: number;
  updatedAt: number;
};

export const storyJobPath = (jobId: string) => `jobs/story/${jobId}.json`;

/** Drawing the pictures for a video. Reports per picture, because it is slow. */
export type StoryImageJob = {
  jobId: string;
  status: "running" | "done" | "error";
  step?: string;
  /** The project with `url` filled in on every picture that got drawn. */
  project?: unknown;
  error?: string;
  warning?: string;
  /** Pictures paid for this run, and pictures taken from the library. */
  drawn?: number;
  reused?: number;
  cents?: number;
  startedAt: number;
  updatedAt: number;
};

export const storyImageJobPath = (jobId: string) =>
  `jobs/story-images/${jobId}.json`;


/**
 * A change to a quiz that already exists.
 *
 * One job type for two jobs — rewriting some questions, and giving them a
 * voice — because from the studio's side they are the same thing: something
 * slow happens on the server and a new list of questions comes back. Two job
 * types would have meant two pollers doing the same work.
 *
 * Never the whole project, only the questions. Everything else on a project —
 * title, thumbnail, which render belongs to it — can be edited while this runs,
 * and a job that returned a whole project would quietly undo those edits.
 */
export type QuizEditJob = {
  jobId: string;
  kind: "requestion" | "narrate";
  status: "running" | "done" | "error";
  step?: string;
  /** QuizQuestion[], validated by the caller. */
  questions?: unknown;
  /** Finished, but not entirely — see the note on QuizJob. */
  warning?: string;
  error?: string;
  startedAt: number;
  updatedAt: number;
};

export const quizEditJobPath = (jobId: string) =>
  `jobs/quiz-edit/${jobId}.json`;

/** A thumbnail background being generated. Same background-job shape as the rest. */
export type ThumbnailJob = {
  jobId: string;
  status: "running" | "done" | "error";
  imageUrl?: string;
  prompt?: string;
  /** The model id that actually drew it, for the studio to report. */
  model?: string;
  error?: string;
  startedAt: number;
  updatedAt: number;
};

export const thumbnailJobPath = (jobId: string) =>
  `jobs/thumbnail/${jobId}.json`;
