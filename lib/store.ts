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

export function hasBlobToken(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

function token(): string {
  const value = process.env.BLOB_READ_WRITE_TOKEN;
  if (!value) throw new BlobNotConfiguredError();
  return value;
}

export async function writeJson(
  pathname: string,
  data: unknown,
): Promise<string> {
  const { url } = await put(pathname, JSON.stringify(data), {
    access: "public",
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
    access: "public",
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
