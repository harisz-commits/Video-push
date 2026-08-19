import { listLanguages } from "../../../lib/elevenlabs";
import { germanName } from "../../../lib/language-names";
import { clientKey, errorResponse, rateLimit } from "../../../lib/guardrails";
import { resolveSpeechModel } from "../../../lib/speech-models";

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

  // Which model is asked about matters now that there is more than one. Flash
  // v2.5 speaks thirty-two languages and Multilingual v2 twenty-nine, and
  // offering the union would mean offering three that the chosen model cannot
  // read. Resolved against the closed list rather than passed through.
  const model = resolveSpeechModel(
    new URL(req.url).searchParams.get("model") ?? undefined,
  );

  const limited = rateLimit(clientKey(req, "languages"), 60, 60_000);
  if (!limited.ok) return errorResponse(limited.error, limited.status);

  try {
    // Named in German, because the names end up on screen as answer options
    // in a German video. Sorted after renaming, or the order would follow
    // words nobody sees.
    const languages = (await listLanguages(apiKey, model.id))
      .map((l) => ({ id: l.id, name: germanName(l.id, l.name) }))
      .sort((a, b) => a.name.localeCompare(b.name, "de"));

    return Response.json({ languages });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[/api/languages]", err);
    return errorResponse(
      "Die Sprachliste konnte nicht geladen werden. Prüfe den ElevenLabs-Key.",
      502,
    );
  }
}
