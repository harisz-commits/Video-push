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
      resolvedFrom: resolveBlobToken()?.name ?? null,
      candidateNames: blobEnvNames(),
    },
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
