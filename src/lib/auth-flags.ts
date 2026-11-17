/**
 * Switches for how people may sign up and in. Read from the environment at REQUEST time (never baked into the build), so
 * changing one in Vercel needs only a Redeploy. Pure functions over an env object, so tests can pass their own.
 *
 *   AUTH_EMAIL_PASSWORD_ENABLED  default true. `false` = Google sign-in only: email + password sign-up, sign-in, verification
 *                                resend and password reset are hidden in the UI and refused by the API.
 *   AUTH_SIGNUP_ALLOWLIST        optional, comma-separated emails. When set, only those addresses can SIGN UP with email +
 *                                password (a brake on abuse: every sign-up sends an email, and the free Brevo plan has a daily cap).
 *                                It does not affect sign-in, and it does not restrict Google sign-in.
 */

type Env = Record<string, string | undefined>;

const TRUE = /^(1|true|yes|on)$/i;
const FALSE = /^(0|false|no|off)$/i;

/** Unset, empty or unrecognised = the default. Use exactly `false` (or 0/no/off) to turn something off. */
export function parseFlag(value: string | undefined, defaultValue: boolean): boolean {
  const v = value?.trim();
  if (!v) return defaultValue;
  if (TRUE.test(v)) return true;
  if (FALSE.test(v)) return false;
  return defaultValue;
}

export const emailPasswordEnabled = (env: Env = process.env): boolean => parseFlag(env.AUTH_EMAIL_PASSWORD_ENABLED, true);

const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]+$/;

/** The allowlist, lower-cased, or null when the mode is off (unset, empty, or nothing valid in it). */
export function signupAllowlist(env: Env = process.env): string[] | null {
  const raw = env.AUTH_SIGNUP_ALLOWLIST;
  if (!raw?.trim()) return null;
  const list = [...new Set(raw.split(",").map((e) => e.trim().toLowerCase()).filter((e) => EMAIL_RE.test(e)))];
  return list.length ? list : null;
}

export const isEmailAllowed = (list: readonly string[], email: unknown): boolean =>
  typeof email === "string" && list.includes(email.trim().toLowerCase());
