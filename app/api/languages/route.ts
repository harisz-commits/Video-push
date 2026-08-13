import { listLanguages } from "../../../lib/elevenlabs";
import { clientKey, errorResponse, rateLimit } from "../../../lib/guardrails";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Which languages a language quiz can use.
 *
 * Read from ElevenLabs rather than kept as a list here: the set is a property
 * of the speaking model, and a copy of it in this repository would be wrong
 * the first time the model changed.
 */
export async function GET(req: Request) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return Response.json({ languages: [] });

  const limited = rateLimit(clientKey(req, "languages"), 60, 60_000);
  if (!limited.ok) return errorResponse(limited.error, limited.status);

  try {
    return Response.json({ languages: await listLanguages(apiKey) });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[/api/languages]", err);
    return errorResponse(
      "Die Sprachliste konnte nicht geladen werden. Prüfe den ElevenLabs-Key.",
      502,
    );
  }
}
