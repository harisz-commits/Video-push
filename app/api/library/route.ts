import { deleteEntry, readLibrary } from "../../../lib/image-library";
import { clientKey, errorResponse, rateLimit } from "../../../lib/guardrails";

export const runtime = "nodejs";

/**
 * What this studio owns.
 *
 * The library existed from the start and was never visible: a summary function
 * nobody called, no route, no view. An archive you cannot look into is not a
 * library — you cannot hear whether a bed is any good, cannot tell which ones
 * earn their keep, and cannot throw out the failures.
 *
 * Sounds first, because they are the reusable half. A picture belongs to one
 * look and comes back only in films that share it; a sound belongs to nothing
 * and fits every film that needs wind.
 */
export async function GET() {
  const { entries } = await readLibrary().catch(() => ({ entries: [] }));

  const sounds = entries
    .filter((e) => e.key.startsWith("sfx-"))
    .map((e) => {
      const match = /^sfx-(ambience|accent)-(.+)$/.exec(e.key);
      const parts = e.prompt.split("|");
      const seconds = Number(parts.length > 1 ? parts[parts.length - 1] : NaN);
      return {
        key: e.key,
        name: e.name,
        kind: match?.[1] ?? "ambience",
        description: (parts.length > 1 ? parts.slice(0, -1).join("|") : e.prompt).trim(),
        seconds: Number.isFinite(seconds) ? Number(seconds.toFixed(1)) : null,
        url: e.url,
        uses: e.uses,
        createdAt: e.createdAt,
      };
    })
    .sort((a, b) => b.uses - a.uses || b.createdAt - a.createdAt);

  const images = entries
    .filter((e) => !e.key.startsWith("sfx-"))
    .map((e) => ({
      key: e.key,
      name: e.name,
      style: e.style,
      url: e.url,
      thumbUrl: e.thumbUrl,
      uses: e.uses,
      createdAt: e.createdAt,
    }))
    .sort((a, b) => b.uses - a.uses || b.createdAt - a.createdAt);

  return Response.json({ sounds, images });
}

export async function DELETE(req: Request) {
  const key = new URL(req.url).searchParams.get("key");
  if (!key || !/^[a-z0-9][a-z0-9-]{2,89}$/.test(key)) {
    return errorResponse("Ungültiger oder fehlender key.", 400);
  }

  // Rate limited, not budgeted: this calls no model. Deleting is also the one
  // action here that cannot be undone, so the limit is tighter than the rest.
  const limited = rateLimit(clientKey(req, "library"), 20, 60_000);
  if (!limited.ok) return errorResponse(limited.error, limited.status);

  const gone = await deleteEntry(key);
  if (!gone) return errorResponse("Diesen Eintrag gibt es nicht.", 404);
  return Response.json({ ok: true });
}
