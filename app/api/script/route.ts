import { waitUntil } from "@vercel/functions";
import { errorResponse, guard } from "../../../lib/guardrails";
import { newContinueToken, researchPhase } from "../../../lib/pipeline";
import { ScriptRequest } from "../../../lib/schema";
import {
  readJson,
  scriptJobPath,
  writeJson,
  type ScriptJob,
} from "../../../lib/store";

export const runtime = "nodejs";
/**
 * This route now only researches and hands off; the writing happens in
 * /api/script/continue on its own clock. 300 is the ceiling on plans above
 * Hobby, where the limit is 60 and neither half would fit.
 */
export const maxDuration = 300;

export async function POST(req: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return errorResponse(
      "ANTHROPIC_API_KEY ist nicht gesetzt. Trag den Key in den Vercel-Projekt-Einstellungen ein und zieh ihn mit `vercel env pull .env.local` lokal nach.",
      500,
    );
  }

  let topic: string;
  try {
    const parsed = ScriptRequest.parse(await req.json());
    topic = parsed.topic;
  } catch {
    return errorResponse(
      "Ungültige Anfrage. Erwartet wird { topic: string } mit 3 bis 200 Zeichen.",
      400,
    );
  }

  const allowed = await guard(req, "script", 6);
  if (!allowed.ok) return errorResponse(allowed.error, allowed.status);

  const jobId = `j${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const startedAt = Date.now();
  // Minted here and stored on the job: it is what lets the second phase be a
  // route without also being an open invitation to re-run it.
  const token = newContinueToken();

  const job: ScriptJob = {
    jobId,
    topic,
    status: "running",
    continueToken: token,
    startedAt,
    updatedAt: startedAt,
  };
  await writeJson(scriptJobPath(jobId), job);

  // Runs past this response. The browser gets an id straight away and polls
  // GET /api/script?jobId=… , so a closed tab no longer costs a script.
  waitUntil(
    researchPhase({
      jobId,
      topic,
      apiKey,
      origin: new URL(req.url).origin,
      token,
      startedAt,
    }),
  );

  return Response.json({ jobId });
}

/** Poll target: the current state of a generation started by POST. */
export async function GET(req: Request) {
  const jobId = new URL(req.url).searchParams.get("jobId");
  if (!jobId || !/^[a-zA-Z0-9_-]{6,64}$/.test(jobId)) {
    return errorResponse("Ungültige oder fehlende jobId.", 400);
  }

  const job = await readJson<ScriptJob>(scriptJobPath(jobId));
  if (!job) {
    return errorResponse(
      "Zu dieser jobId gibt es keinen Auftrag. Entweder läuft er noch nicht oder er ist älter als die Aufbewahrungsfrist.",
      404,
    );
  }
  // A job whose function was killed mid-flight stays "running" forever: there
  // is nobody left to write the failure. Generation spans two invocations now,
  // so the point of no return is twice the ceiling plus a margin — anything
  // still running past that is dead, and saying so beats an endless spinner.
  if (
    job.status === "running" &&
    Date.now() - job.startedAt > (maxDuration * 2 + 30) * 1000
  ) {
    return Response.json({
      ...job,
      status: "error",
      error:
        "Die Erzeugung wurde abgebrochen, weil sie das Zeitlimit der Funktion überschritten hat. Versuch es noch einmal.",
    } satisfies ScriptJob);
  }

  // The continue token is server-side plumbing, not something a poller needs.
  const { continueToken: _withheld, ...visible } = job;
  return Response.json(visible);
}
