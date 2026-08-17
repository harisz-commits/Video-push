import { head } from "@vercel/blob";
import { DEFAULT_MODEL } from "../../../lib/gemini";
import { DEFAULT_TEXT_MODEL } from "../../../lib/text-models";
import { blobEnvNames, resolveBlobToken } from "../../../lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * What the running instance actually sees.
 *
 * Reports presence as booleans only — never a value, never a prefix. A key is
 * either configured or it is not, and that is the whole question this answers.
 * It sits behind the password gate like everything else.
 *
 * Exists because "the store is connected in the dashboard" and "this
 * deployment received the variable" are different claims: Vercel binds
 * environment variables when a deployment is created, so a deployment made
 * before the store was attached keeps running without it.
 */
export async function GET() {
  const blob = resolveBlobToken();

  return Response.json({
    env: {
      ANTHROPIC_API_KEY: Boolean(process.env.ANTHROPIC_API_KEY),
      ELEVENLABS_API_KEY: Boolean(process.env.ELEVENLABS_API_KEY),
      ELEVENLABS_VOICE_ID: Boolean(process.env.ELEVENLABS_VOICE_ID),
      // Only the thumbnail's background image needs this. Everything else —
      // including the rest of the thumbnail — works without it.
      GEMINI_API_KEY: Boolean(process.env.GEMINI_API_KEY),
      BLOB_READ_WRITE_TOKEN: Boolean(process.env.BLOB_READ_WRITE_TOKEN),
      STUDIO_PASSWORD: Boolean(process.env.STUDIO_PASSWORD),
    },
    // Which variable the Blob layer actually resolved, and every Blob-ish name
    // present. Names are not secrets; values are never reported.
    blob: {
      resolvedFrom: blob?.name ?? null,
      candidateNames: blobEnvNames(),
    },
    // Whether THIS deployment has a render snapshot.
    //
    // The snapshot step no longer fails the build, which means a deployment can
    // now be perfectly healthy and still unable to render. That is a better
    // trade than blocking every unrelated fix behind it, but it has to be
    // visible somewhere other than the first failed render.
    snapshot: await snapshotState(blob?.value),
    // What the voice budget actually is, from ElevenLabs itself.
    //
    // Every question about whether a feature is affordable — reading the
    // questions aloud, a longer outro, a second voice — is really a question
    // about how many characters are left this month, and that number was only
    // ever visible by logging into someone else's dashboard.
    voice: await voiceQuota(),
    // Which Gemini models this key can actually call.
    //
    // Google both renames models and retires older ones for existing keys —
    // "no longer available to new users" arrives as a 404 on the first real
    // request, not as anything you can see in advance. Asking the catalogue
    // endpoint is free and turns "which ids exist" from guesswork into a list.
    googleModels: await googleModels(),
    settings: {
      // Which model writes a quiz when nobody picks one in the studio, and
      // which provider it therefore needs a key for.
      QUIZ_TEXT_MODEL: `${DEFAULT_TEXT_MODEL.id} (${DEFAULT_TEXT_MODEL.provider})`,
      ANTHROPIC_EFFORT: process.env.ANTHROPIC_EFFORT ?? "low",
      DAILY_SCRIPT_LIMIT: process.env.DAILY_SCRIPT_LIMIT ?? "40",
      DAILY_VOICE_LIMIT: process.env.DAILY_VOICE_LIMIT ?? "20",
      DAILY_RENDER_LIMIT: process.env.DAILY_RENDER_LIMIT ?? "10",
      // Which model a thumbnail image is asked of when nobody picked one in
      // the studio, so a renamed or retired id is visible here rather than
      // only in a failed generation.
      GEMINI_IMAGE_MODEL: DEFAULT_MODEL.id,
    },
    // Identifies which build is answering, so a stale deployment is obvious.
    deployment: {
      env: process.env.VERCEL_ENV ?? "local",
      commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
      branch: process.env.VERCEL_GIT_COMMIT_REF ?? null,
      deploymentId: process.env.VERCEL_DEPLOYMENT_ID ?? null,
      region: process.env.VERCEL_REGION ?? null,
    },
    now: new Date().toISOString(),
  });
}

/**
 * Turn a Sandbox API status code into something actionable.
 *
 * "Status code 402 is not ok" is technically accurate and practically useless:
 * it sends whoever reads it looking for a bug in the build, when the build is
 * fine and the account simply will not grant a sandbox. The one that cost a
 * day of looking in the wrong place gets spelled out.
 */
function explainSnapshotFailure(reason: SnapshotFailure): string {
  const message = reason.message ?? "";
  // Vercel's own words, when the build managed to capture them. Everything
  // below this line is interpretation; this line is evidence, and it is the
  // only part that names which limit was hit.
  const verbatim = reason.body
    ? ` Wortlaut der API${reason.status ? ` (HTTP ${reason.status})` : ""}: ${reason.body.slice(0, 400)}`
    : " Die Antwort der API wurde von diesem Build noch nicht mitgeschrieben — der nächste Build hält sie fest.";

  // The specific 402 this project actually hits. Snapshots were created with no
  // expiry and never deleted, so the plan's snapshot storage filled up and no
  // further snapshot could be created. Worth naming precisely, because the
  // generic "payment required" reading sends you to the billing page for a
  // problem that a cleanup fixes.
  if (reason.body?.includes("Snapshots Storage")) {
    return `Der Snapshot-Speicher des Vercel-Tarifs ist voll — deshalb konnte dieser Build keinen neuen Snapshot anlegen, und deshalb geht Rendern nicht. Kein Ausgabenlimit und kein Fehler im Code. Ursache war, dass Snapshots ohne Ablaufdatum angelegt und nie gelöscht wurden, also pro Deployment einer liegen blieb. Ab jetzt räumt jeder Build vor dem Anlegen auf und der neue Snapshot läuft nach 14 Tagen selbst ab; der nächtliche Cron hält es zusätzlich sauber. Falls diese Meldung nach dem nächsten Deployment noch steht, ist der Speicher auch mit einem einzigen Snapshot zu klein — dann hilft nur ein größerer Tarif.${verbatim}`;
  }
  if (message.includes("402") || reason.status === 402) {
    return `Der Vercel-Account gibt dem Snapshot-Schritt keine Sandbox: die API antwortet mit 402 (Payment Required). Das ist kein Fehler im Code — Build, Bundle und Deployment sind in Ordnung. 402 heißt nur "der Account zahlt dafür nicht"; welche Grenze das genau ist, sagt der Wortlaut unten. In Frage kommen: ein aufgebrauchtes Kontingent im Tarif, das Ausgabenlimit unter Vercel → Settings → Spend Management, oder eine nicht hinterlegte Zahlungsmethode.${verbatim} Bis dahin laufen Skript und Stimme normal, nur Rendern nicht.`;
  }
  if (message.includes("429") || reason.status === 429) {
    return `Der Snapshot-Schritt wurde von der Sandbox-API ausgebremst (429). Ein erneutes Deployment in ein paar Minuten hilft meistens.${verbatim}`;
  }
  return `Der Snapshot-Schritt ist fehlgeschlagen: ${message.slice(0, 300)}${verbatim}`;
}

/**
 * The ElevenLabs allowance, as ElevenLabs sees it.
 *
 * Read-only and free — it is the subscription endpoint, not synthesis. Failure
 * is reported rather than thrown: a voice quota nobody can read is a nuisance,
 * a health endpoint that 500s because of it is a much bigger one.
 */
async function voiceQuota(): Promise<Record<string, unknown> | null> {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch("https://api.elevenlabs.io/v1/user/subscription", {
      headers: { "xi-api-key": key },
      cache: "no-store",
    });
    if (!res.ok) return { error: `HTTP ${res.status}` };
    const body = (await res.json()) as {
      tier?: string;
      character_count?: number;
      character_limit?: number;
      next_character_count_reset_unix?: number;
    };
    const used = body.character_count ?? 0;
    const limit = body.character_limit ?? 0;
    return {
      tier: body.tier ?? null,
      used,
      limit,
      remaining: Math.max(0, limit - used),
      resetsAt: body.next_character_count_reset_unix
        ? new Date(body.next_character_count_reset_unix * 1000).toISOString()
        : null,
    };
  } catch (err) {
    return { error: (err as Error).message.slice(0, 120) };
  }
}

async function googleModels(): Promise<unknown> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models?pageSize=200",
      { headers: { "x-goog-api-key": key }, cache: "no-store" },
    );
    if (!res.ok) return { error: `HTTP ${res.status}` };
    const body = (await res.json()) as {
      models?: {
        name?: string;
        displayName?: string;
        supportedGenerationMethods?: string[];
      }[];
    };
    return (body.models ?? [])
      .filter((m) => m.supportedGenerationMethods?.includes("generateContent"))
      .map((m) => (m.name ?? "").replace(/^models\//, ""))
      .filter(Boolean)
      .sort();
  } catch (err) {
    return { error: (err as Error).message.slice(0, 120) };
  }
}

type SnapshotFailure = {
  message?: string;
  status?: number | null;
  body?: string | null;
  at?: string;
};

/**
 * Read a Blob document, or nothing at all.
 *
 * Nothing here may throw. This whole endpoint exists to explain a broken
 * deployment, and it used to fail at exactly that job: the lookup for the
 * build's error report sat inside the catch block that handled the missing
 * snapshot, unguarded. A deployment with neither document — no snapshot AND no
 * recorded reason, which is precisely the state worth diagnosing — made
 * /api/health answer 500 with an empty body. The one tool for finding out what
 * was wrong broke on the case it was built for.
 */
async function readBlob<T>(key: string, token: string): Promise<T | null> {
  try {
    const meta = await head(key, { token });
    const response = await fetch(`${meta.url}?t=${Date.now()}`);
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

async function snapshotState(token: string | undefined): Promise<{
  present: boolean;
  note: string;
  snapshotId?: string;
  fingerprint?: string;
}> {
  if (!token) {
    return { present: false, note: "Kein Blob-Store — Rendern nicht möglich." };
  }
  const id = process.env.VERCEL_DEPLOYMENT_ID ?? "local";

  // Which image this deployment renders from, and the fingerprint of the
  // content it was built for. Two deployments showing the same pair means the
  // second one reused the first one's snapshot instead of creating a second
  // copy — the only way to see from outside that a build cost no storage.
  const pointer = await readBlob<{ snapshotId?: string; fingerprint?: string }>(
    `snapshot-cache/${id}.json`,
    token,
  );
  if (pointer?.snapshotId) {
    return {
      present: true,
      note: "Rendern möglich.",
      snapshotId: pointer.snapshotId,
      fingerprint: pointer.fingerprint,
    };
  }

  // The build writes its reason next to where the snapshot would have gone, so
  // the answer to "why can't it render" lives here rather than only in a build
  // log nobody can reach from the running app.
  const reason = await readBlob<SnapshotFailure>(
    `snapshot-cache/${id}.error.json`,
    token,
  );
  if (reason?.message) {
    return { present: false, note: explainSnapshotFailure(reason) };
  }

  // Neither document. The build did not fail the snapshot step — it never
  // reached it, or skipped it. The skip has exactly one cause: no Blob token
  // in the BUILD environment. Vercel binds variables when a deployment is
  // created, so a store attached after this deployment was built is present at
  // runtime — this endpoint can read Blob, or it would not have got this far —
  // and absent at build time. Redeploying is what fixes that, and it is worth
  // naming, because "the store is connected" is true and beside the point.
  return {
    present: false,
    note:
      `Weder ein Snapshot-Zeiger noch ein Fehlerbericht für Deployment ${id}. ` +
      "Der Build hat den Snapshot-Schritt also nicht versucht, sondern übersprungen — " +
      "das passiert nur, wenn beim BUILD kein Blob-Token in der Umgebung lag. " +
      "Zur Laufzeit liegt eines vor (sonst käme diese Antwort nicht zustande), " +
      "was zusammenpasst: Vercel bindet Variablen beim Erzeugen des Deployments ein. " +
      "Ein neues Deployment behebt es. Im Build-Log steht die Zeile „[snapshot] ÜBERSPRUNGEN“ " +
      "mit den gefundenen Variablennamen.",
  };
}
