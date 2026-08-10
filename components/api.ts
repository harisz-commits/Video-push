"use client";

/**
 * One place where every studio API call goes through.
 *
 * The rule that matters: never call response.json() before knowing there is
 * JSON to parse. A gateway timeout, an HTML error page or the password gate's
 * plain-text 401 would all make json() throw, and a naive try/catch then
 * reports "server unreachable" for a server that answered perfectly clearly.
 * That hides the actual problem, which is the opposite of what an error
 * message is for.
 */

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export async function postJson<T>(
  path: string,
  body: unknown,
): Promise<ApiResult<T>> {
  let response: Response;

  try {
    response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    // Only a genuine transport failure reaches this branch.
    return {
      ok: false,
      error:
        "Keine Verbindung zum Server. Prüfe deine Internetverbindung und versuch es erneut.",
    };
  }

  return interpret<T>(response, path);
}

export async function getJson<T>(path: string): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(path);
  } catch {
    return { ok: false, error: "Keine Verbindung zum Server." };
  }
  return interpret<T>(response, path);
}

async function interpret<T>(
  response: Response,
  path: string,
): Promise<ApiResult<T>> {
  const raw = await response.text().catch(() => "");

  let parsed: unknown = null;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    parsed = null;
  }

  const apiError =
    parsed && typeof parsed === "object" && "error" in parsed
      ? String((parsed as { error: unknown }).error)
      : null;

  if (response.ok && parsed !== null && !apiError) {
    return { ok: true, data: parsed as T };
  }

  // The route answered in its own words — that message is the best one we have.
  if (apiError) return { ok: false, error: apiError };

  return { ok: false, error: describe(response, raw, path) };
}

/**
 * Turn a non-JSON response into something actionable. These are exactly the
 * cases the old code collapsed into "server unreachable".
 */
function describe(response: Response, raw: string, path: string): string {
  const { status } = response;

  if (status === 401) {
    return "Die Sitzung ist abgelaufen. Lade die Seite neu und melde dich erneut an.";
  }

  if (status === 504 || status === 408) {
    return `Zeitüberschreitung: ${path} hat länger gebraucht, als die Vercel-Function laufen darf. Auf dem Hobby-Plan liegt die Grenze bei 60 Sekunden. Setze ANTHROPIC_EFFORT auf "low" oder wechsle auf einen Plan mit längerem Limit.`;
  }

  if (status === 413) {
    return "Die Anfrage war zu groß für den Server. Kürze das Skript.";
  }

  if (status >= 500) {
    return `Der Server hat mit ${status} geantwortet, ohne verwertbare Fehlermeldung. Sieh im Vercel-Dashboard unter Logs nach dem Aufruf von ${path}.${snippet(raw)}`;
  }

  return `Unerwartete Antwort (${status}) von ${path}.${snippet(raw)}`;
}

/** A short excerpt of a non-JSON body, in case it says something useful. */
function snippet(raw: string): string {
  const text = raw.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  return text ? ` Serverantwort: „${text.slice(0, 160)}"` : "";
}
