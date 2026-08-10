import { hasBlobToken, readJson, writeJson } from "./store";

/**
 * Every call to /api/script, /api/voice and /api/render spends real money —
 * Anthropic tokens, ElevenLabs characters, Vercel Sandbox minutes. Three layers
 * sit in front of them, weakest to strongest:
 *
 *   1. Password protection (middleware.ts) — nobody unauthenticated gets this far.
 *   2. Per-instance rate limiting — burst protection, cheap, no storage.
 *   3. A persisted daily cap — the actual ceiling on a day's spend.
 *
 * Layer 3 is a read-modify-write against Blob, so two truly simultaneous
 * requests can both read the same count and one increment can be lost. For a
 * single-operator studio behind a password that is an acceptable trade against
 * running a database; the cap is a budget guard, not a billing ledger.
 */

export type Guard = { ok: true } | { ok: false; status: number; error: string };

// ---------------------------------------------------------------------------
// Layer 2: in-memory sliding window, per serverless instance.
// ---------------------------------------------------------------------------

const hits = new Map<string, number[]>();

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): Guard {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);

  if (recent.length >= limit) {
    const retryIn = Math.ceil((windowMs - (now - recent[0])) / 1000);
    return {
      ok: false,
      status: 429,
      error: `Zu viele Anfragen. Versuch es in ${retryIn} Sekunden erneut.`,
    };
  }

  recent.push(now);
  hits.set(key, recent);

  // Keep the map from growing without bound on a long-lived instance.
  if (hits.size > 500) {
    for (const [k, v] of hits) {
      if (v.every((t) => now - t >= windowMs)) hits.delete(k);
    }
  }

  return { ok: true };
}

export function clientKey(req: Request, route: string): string {
  const forwarded = req.headers.get("x-forwarded-for") ?? "";
  const ip = forwarded.split(",")[0].trim() || "unknown";
  return `${route}:${ip}`;
}

// ---------------------------------------------------------------------------
// Layer 3: persisted daily budget.
// ---------------------------------------------------------------------------

export type BudgetKind = "script" | "voice" | "render";

const DEFAULT_DAILY_LIMITS: Record<BudgetKind, number> = {
  script: 40,
  voice: 20,
  render: 10,
};

const ENV_KEYS: Record<BudgetKind, string> = {
  script: "DAILY_SCRIPT_LIMIT",
  voice: "DAILY_VOICE_LIMIT",
  render: "DAILY_RENDER_LIMIT",
};

export function dailyLimit(kind: BudgetKind): number {
  const raw = process.env[ENV_KEYS[kind]];
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(parsed) && parsed >= 0
    ? parsed
    : DEFAULT_DAILY_LIMITS[kind];
}

const today = () => new Date().toISOString().slice(0, 10);
const budgetPath = (day: string) => `budget/${day}.json`;

type BudgetDoc = Partial<Record<BudgetKind, number>>;

export async function readBudget(): Promise<Record<BudgetKind, number>> {
  const doc = (await readJson<BudgetDoc>(budgetPath(today()))) ?? {};
  return {
    script: doc.script ?? 0,
    voice: doc.voice ?? 0,
    render: doc.render ?? 0,
  };
}

/**
 * Reserve one unit of the day's budget for `kind`, or refuse.
 *
 * Reserved before the expensive call, not after — a run that crashes halfway
 * has still consumed tokens or sandbox time, and a counter that only increments
 * on success would let a crash loop spend without limit.
 */
export async function consumeDailyBudget(kind: BudgetKind): Promise<Guard> {
  const limit = dailyLimit(kind);
  if (limit === 0) {
    return {
      ok: false,
      status: 403,
      error: `${label(kind)} ist deaktiviert (${ENV_KEYS[kind]}=0).`,
    };
  }

  // The counter lives in Vercel Blob, so no store means no way to enforce the
  // cap. Checked up front and by name: without this, every expensive route
  // fails deep inside the storage layer with an error about a token, which
  // says nothing about why generating a script needs blob storage at all.
  if (!hasBlobToken()) {
    return {
      ok: false,
      status: 503,
      error:
        "Kein Blob-Store verbunden. Das Tagesbudget wird dort gezählt, und ohne diesen Zähler wird jede kostenpflichtige Anfrage abgelehnt. Auf vercel.com unter Storage einen Blob-Store anlegen, diesem Projekt zuweisen und neu deployen.",
    };
  }

  const day = today();
  let doc: BudgetDoc;
  try {
    doc = (await readJson<BudgetDoc>(budgetPath(day))) ?? {};
  } catch {
    // Refuse rather than spend blind — the point of this layer is that it
    // cannot be bypassed, least of all by its own storage being flaky.
    return {
      ok: false,
      status: 503,
      error:
        "Das Tagesbudget lässt sich gerade nicht lesen. Aus Kostengründen wird die Anfrage abgelehnt.",
    };
  }

  const used = doc[kind] ?? 0;
  if (used >= limit) {
    return {
      ok: false,
      status: 429,
      error: `Tageslimit erreicht: ${used} von ${limit} ${label(kind)} heute. Setze ${ENV_KEYS[kind]} höher oder warte bis morgen.`,
    };
  }

  try {
    await writeJson(budgetPath(day), { ...doc, [kind]: used + 1 });
  } catch {
    // Same reasoning as the read: an uncounted call is an uncapped call.
    return {
      ok: false,
      status: 503,
      error:
        "Das Tagesbudget lässt sich gerade nicht fortschreiben. Aus Kostengründen wird die Anfrage abgelehnt.",
    };
  }

  return { ok: true };
}

function label(kind: BudgetKind): string {
  return kind === "script"
    ? "Skript-Erzeugungen"
    : kind === "voice"
      ? "Voiceover-Erzeugungen"
      : "Renders";
}

// ---------------------------------------------------------------------------
// Convenience wrapper used by every expensive route.
// ---------------------------------------------------------------------------

export async function guard(
  req: Request,
  kind: BudgetKind,
  perMinute: number,
): Promise<Guard> {
  const limited = rateLimit(clientKey(req, kind), perMinute, 60_000);
  if (!limited.ok) return limited;
  return consumeDailyBudget(kind);
}

/** Uniform error body — never leak a stack trace to the browser. */
export function errorResponse(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}
