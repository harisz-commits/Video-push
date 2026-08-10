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

/** Progress document written by /api/render and read by /api/progress. */
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
  /** Present once status is "done". Shape validated by VideoProject. */
  project?: unknown;
  error?: string;
  startedAt: number;
  updatedAt: number;
};

export const scriptJobPath = (jobId: string) => `jobs/script/${jobId}.json`;
