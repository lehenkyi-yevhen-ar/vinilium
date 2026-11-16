"use client";

import { useTranslations } from "next-intl";

type AuthError = { code?: string; status?: number; message?: string } | null | undefined;

/** Maps a Better Auth error to a localized message (never shows raw server text). */
export function useAuthError() {
  const t = useTranslations("auth.errors");
  const c = useTranslations("common");
  return (error: AuthError): string | null => {
    if (!error) return null;
    if (error.status === 429) return c("tooManyRequests");
    if (error.code && t.has(error.code as never)) return t(error.code as never);
    return c("genericError");
  };
}

/** Zod issues -> { field: first message }. */
export function fieldErrors(issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>) {
  const out: Record<string, string> = {};
  for (const i of issues) {
    const key = String(i.path[0] ?? "form");
    if (!(key in out)) out[key] = i.message;
  }
  return out;
}
