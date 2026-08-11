import { waitUntil } from "@vercel/functions";
import { errorResponse } from "../../../../lib/guardrails";
import { writePhase } from "../../../../lib/pipeline";
import { readJson, scriptJobPath, type ScriptJob } from "../../../../lib/store";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * The second half of script generation, as its own function invocation.
 *
 * Research and writing could not share one: a function lives five minutes, and
 * looking facts up on the web repeatedly took longer than that by itself. This
 * endpoint exists so the writing half starts with a fresh five minutes rather
 * than whatever the research left over.
 *
 * It is called by the first phase, not by a browser. The token it demands was
 * minted when the job was created and is stored on the job — without it, this
 * would be an open endpoint for re-running the expensive half of somebody
 * else's job as often as anyone liked.
 */
export async function POST(req: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return errorResponse("ANTHROPIC_API_KEY ist nicht gesetzt.", 500);

  let jobId: string;
  let token: string;
  let research: string;
  try {
    const body = (await req.json()) as {
      jobId?: string;
      token?: string;
      research?: string;
    };
    if (!body.jobId || !body.token || !body.research) {
      throw new Error("incomplete");
    }
    jobId = body.jobId;
    token = body.token;
    research = body.research;
  } catch {
    return errorResponse("Ungültige Anfrage.", 400);
  }

  const job = await readJson<ScriptJob>(scriptJobPath(jobId));
  if (!job) return errorResponse("Unbekannter Auftrag.", 404);

  // Constant-ish comparison is not the point here — the token is single-use in
  // practice and not a long-lived secret. What matters is that it is required.
  if (!job.continueToken || job.continueToken !== token) {
    return errorResponse("Nicht autorisiert.", 401);
  }
  if (job.status !== "running") {
    return errorResponse("Dieser Auftrag läuft nicht mehr.", 409);
  }

  waitUntil(
    writePhase({
      jobId,
      topic: job.topic,
      research,
      apiKey,
      startedAt: job.startedAt,
    }),
  );

  // Acknowledge immediately: the caller is the research phase, which must not
  // sit waiting on work that has its own five minutes to finish in.
  return Response.json({ ok: true }, { status: 202 });
}
