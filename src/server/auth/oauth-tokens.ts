/**
 * We sign users in with Google for their basic profile only (name, email, picture) and never call a Google API on their behalf,
 * so the OAuth tokens Better Auth hands us have no use here. By default it stores them in the `account` table; we store NULL
 * instead, which keeps the database free of long-lived credentials for a user's Google account. (Existing rows, if any, can be
 * cleaned with the statement in docs/operations.md.)
 */
export const OAUTH_TOKEN_FIELDS = ["accessToken", "refreshToken", "idToken", "accessTokenExpiresAt", "refreshTokenExpiresAt"] as const;

export function stripOAuthTokens<T extends Record<string, unknown>>(data: T): T {
  const next: Record<string, unknown> = { ...data };
  for (const field of OAUTH_TOKEN_FIELDS) if (field in next) next[field] = null;
  return next as T;
}
