import { clientKey, errorResponse, rateLimit } from "../../../../lib/guardrails";
import { deleteLook, readLooks, saveLook } from "../../../../lib/looks";
import { StoryStyle } from "../../../../lib/story";

export const runtime = "nodejs";

/**
 * The looks this studio keeps.
 *
 * Cheap on purpose — no model is called here and nothing is drawn. A look is
 * four fields of text, and the value is entirely in the fact that the same
 * four fields come back next month: two films sharing a look share their
 * picture library, and a style regenerated from the same topic would be a
 * near-miss that shares nothing.
 */
export async function GET() {
  const { looks } = await readLooks().catch(() => ({ looks: [] }));
  return Response.json({ looks });
}

export async function POST(req: Request) {
  let label: string;
  let style: StoryStyle;
  let id: string | undefined;
  try {
    const body = (await req.json()) as {
      id?: unknown;
      label?: unknown;
      style?: unknown;
    };
    style = StoryStyle.parse(body.style);
    label = typeof body.label === "string" ? body.label.trim().slice(0, 80) : "";
    id =
      typeof body.id === "string" && /^[a-zA-Z0-9_-]{4,64}$/.test(body.id)
        ? body.id
        : undefined;
  } catch {
    return errorResponse(
      "Ungültige Anfrage. Erwartet wird { label, style }.",
      400,
    );
  }

  // Rate limited but NOT budgeted. guard() would also consume a day's script
  // allowance, and saving a look calls no model at all — a person tidying up
  // their saved styles must not use up the films they are allowed to write.
  const limited = rateLimit(clientKey(req, "looks"), 30, 60_000);
  if (!limited.ok) return errorResponse(limited.error, limited.status);

  const look = await saveLook({ id, label: label || style.name, style });
  return Response.json({ look });
}

export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id || !/^[a-zA-Z0-9_-]{4,64}$/.test(id)) {
    return errorResponse("Ungültige oder fehlende id.", 400);
  }
  await deleteLook(id);
  return Response.json({ ok: true });
}
