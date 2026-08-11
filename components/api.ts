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
  } catch (err) {
    return { ok: false, error: transportError(err) };
  }

  return interpret<T>(response, path);
}

export async function getJson<T>(path: string): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(path);
  } catch (err) {
    return { ok: false, error: transportError(err) };
  }
  return interpret<T>(response, path);
}

/**
 * Tell a dead network apart from a request the browser itself killed.
 *
 * They arrive as the same rejected fetch, and calling both "no connection to
 * the server" sent people to check their wifi over a request that was
 * cancelled locally — which is what happens when a tab goes to the background
 * while something is in flight. Naming it is the difference between a
 * misleading instruction and an accurate one.
 */
function transportError(err: unknown): string {
  const name = (err as { name?: string } | null)?.name;
  if (name === "AbortError") {
    return "Die Anfrage wurde vom Browser abgebrochen — das passiert, wenn der Tab in den Hintergrund geht. Der Server arbeitet weiter; komm zurück und lade die Seite neu.";
  }
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return "Keine Internetverbindung. Sobald du wieder online bist, versuch es erneut.";
  }
  return "Keine Verbindung zum Server. Prüfe deine Internetverbindung und versuch es erneut.";
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
    return `Zeitüberschreitung: ${path} hat länger gebraucht, als die Vercel-Function laufen darf (60 Sekunden auf Hobby, sonst bis zu 300). Bei der Skripterzeugung hilft ANTHROPIC_EFFORT=low; bleibt es dabei, kürze die Wortvorgabe in lib/prompt.ts.`;
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
