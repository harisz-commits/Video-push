import {
  deleteCharacter,
  readCharacters,
  saveCharacter,
} from "../../../../lib/characters";
import { clientKey, errorResponse, rateLimit } from "../../../../lib/guardrails";

export const runtime = "nodejs";

/**
 * The figures this studio keeps.
 *
 * What is stored is the description as it was written, never the English
 * appearance a film derived from it — that belongs to one look. See
 * lib/characters.ts.
 */
export async function GET() {
  const { characters } = await readCharacters().catch(() => ({
    characters: [],
  }));
  return Response.json({ characters });
}

export async function POST(req: Request) {
  let name: string;
  let description: string;
  let key: string | undefined;
  try {
    const body = (await req.json()) as {
      key?: unknown;
      name?: unknown;
      description?: unknown;
    };
    name = typeof body.name === "string" ? body.name.trim().slice(0, 80) : "";
    description =
      typeof body.description === "string"
        ? body.description.trim().slice(0, 600)
        : "";
    key = typeof body.key === "string" ? body.key.slice(0, 80) : undefined;
    if (name.length < 2 || description.length < 3) throw new Error("leer");
  } catch {
    return errorResponse(
      "Ungültige Anfrage. Erwartet wird { name, description }.",
      400,
    );
  }

  // Rate limited but NOT budgeted — see the note in the looks route: this
  // calls no model, so it must not spend a day's script allowance.
  const limited = rateLimit(clientKey(req, "characters"), 30, 60_000);
  if (!limited.ok) return errorResponse(limited.error, limited.status);

  const character = await saveCharacter({ name, description, key });
  return Response.json({ character });
}

export async function DELETE(req: Request) {
  const key = new URL(req.url).searchParams.get("key");
  if (!key || !/^[a-z0-9][a-z0-9-]{2,79}$/.test(key)) {
    return errorResponse("Ungültiger oder fehlender key.", 400);
  }
  await deleteCharacter(key);
  return Response.json({ ok: true });
}
