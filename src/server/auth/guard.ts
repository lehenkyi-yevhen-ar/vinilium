import { emailPasswordEnabled, isEmailAllowed, signupAllowlist } from "@/lib/auth-flags";

/**
 * Runs in front of every /api/auth/* request (see the route). It applies the two sign-up switches in lib/auth-flags.ts and
 * answers with the same `{ code, message }` shape Better Auth uses, so the UI maps it to a translated message like any other
 * auth error. Returns a Response to send, or null to let Better Auth handle the request.
 */

/** Endpoints that exist only for email + password accounts. `/verify-email` (the link in an email) and signed-in actions stay. */
const EMAIL_PASSWORD_PATHS = ["/sign-up/email", "/sign-in/email", "/send-verification-email", "/request-password-reset", "/forget-password", "/reset-password"];

export const EMAIL_PASSWORD_DISABLED = "EMAIL_PASSWORD_DISABLED";
export const SIGNUP_INVITE_ONLY = "SIGNUP_INVITE_ONLY";

const refuse = (code: string, message: string, status = 403) => Response.json({ code, message }, { status, headers: { "Cache-Control": "no-store" } });

export function authSubPath(url: string): string {
  return new URL(url).pathname.replace(/^\/api\/auth/, "") || "/";
}

export async function guardAuthRequest(request: Request, env: Record<string, string | undefined> = process.env): Promise<Response | null> {
  const path = authSubPath(request.url);
  const emailPasswordPath = EMAIL_PASSWORD_PATHS.some((p) => path === p || path.startsWith(`${p}/`));

  if (emailPasswordPath && !emailPasswordEnabled(env)) {
    return refuse(EMAIL_PASSWORD_DISABLED, "Email and password sign-in is turned off. Please continue with Google.");
  }

  if (request.method === "POST" && path === "/sign-up/email") {
    const allow = signupAllowlist(env);
    if (allow) {
      const body = (await request.clone().json().catch(() => null)) as { email?: unknown } | null;
      if (!isEmailAllowed(allow, body?.email)) return refuse(SIGNUP_INVITE_ONLY, "Sign-up is by invitation only.");
    }
  }
  return null;
}
