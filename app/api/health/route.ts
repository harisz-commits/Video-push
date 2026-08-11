import { head } from "@vercel/blob";
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
    settings: {
      ANTHROPIC_MODEL: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5",
      ANTHROPIC_EFFORT: process.env.ANTHROPIC_EFFORT ?? "low",
      DAILY_SCRIPT_LIMIT: process.env.DAILY_SCRIPT_LIMIT ?? "40",
      DAILY_VOICE_LIMIT: process.env.DAILY_VOICE_LIMIT ?? "20",
      DAILY_RENDER_LIMIT: process.env.DAILY_RENDER_LIMIT ?? "10",
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
function explainSnapshotFailure(message: string): string {
  if (message.includes("402")) {
    return "Der Snapshot-Schritt bekommt vom Vercel-Account keine Sandbox: die API antwortet mit 402 (Payment Required). Das ist kein Fehler im Code — Build, Bundle und Deployment sind in Ordnung. Ursache ist ein Ausgabenlimit oder ein aufgebrauchtes Sandbox-Kontingent. Vercel → Settings → Spend Management prüfen, und ob Sandbox im aktuellen Tarif noch Guthaben hat. Bis dahin laufen Skript und Stimme normal, nur Rendern nicht.";
  }
  if (message.includes("429")) {
    return "Der Snapshot-Schritt wurde von der Sandbox-API ausgebremst (429). Ein erneutes Deployment in ein paar Minuten hilft meistens.";
  }
  return `Der Snapshot-Schritt ist fehlgeschlagen: ${message.slice(0, 300)}`;
}

async function snapshotState(
  token: string | undefined,
): Promise<{ present: boolean; note: string }> {
  if (!token) {
    return { present: false, note: "Kein Blob-Store — Rendern nicht möglich." };
  }
  const id = process.env.VERCEL_DEPLOYMENT_ID ?? "local";
  try {
    await head(`snapshot-cache/${id}.json`, { token });
    return { present: true, note: "Rendern möglich." };
  } catch {
    // The build writes its reason next to where the snapshot would have gone,
    // so the answer to "why can't it render" lives here rather than only in a
    // build log nobody can reach from the running app.
    const reason = await fetch(
      `${(await head(`snapshot-cache/${id}.error.json`, { token })).url}?t=${Date.now()}`,
    )
      .then((r) => r.json() as Promise<{ message?: string; at?: string }>)
      .catch(() => null);

    return {
      present: false,
      note: reason?.message
        ? explainSnapshotFailure(reason.message)
        : "Für dieses Deployment wurde kein Snapshot erzeugt. Die App läuft, aber Rendern schlägt fehl, bis ein Build den Snapshot-Schritt durchbekommt.",
    };
  }
}
