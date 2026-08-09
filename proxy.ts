import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Password gate in front of the entire app.
 *
 * Next.js 16 renamed this convention from `middleware` to `proxy`; the
 * behaviour is unchanged.
 *
 * This is the outermost cost guardrail: every expensive route sits behind it,
 * so an unauthenticated visitor can never spend Anthropic tokens, ElevenLabs
 * characters or Sandbox minutes. HTTP Basic keeps it to one env var with no
 * login page, no session store and no cookie handling.
 *
 * Leave STUDIO_PASSWORD unset for local development and the gate is skipped.
 */
export function proxy(req: NextRequest) {
  const expected = process.env.STUDIO_PASSWORD;
  if (!expected) return NextResponse.next();

  // Let the Vercel cron hit the cleanup job; it authenticates with CRON_SECRET.
  if (req.nextUrl.pathname.startsWith("/api/cron/")) {
    return NextResponse.next();
  }

  const header = req.headers.get("authorization");
  if (header?.startsWith("Basic ")) {
    const decoded = atob(header.slice(6));
    const password = decoded.slice(decoded.indexOf(":") + 1);
    if (timingSafeEqual(password, expected)) return NextResponse.next();
  }

  return new NextResponse("Zugang nur mit Passwort.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Infographics Studio"' },
  });
}

/** Constant-time compare so the gate does not leak the password by timing. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|fonts/).*)"],
};
