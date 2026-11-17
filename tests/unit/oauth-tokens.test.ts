import { beforeEach, describe, expect, it, vi } from "vitest";
import { OAUTH_TOKEN_FIELDS, stripOAuthTokens } from "@/server/auth/oauth-tokens";
import { setEnv } from "../helpers/env";

describe("stripOAuthTokens", () => {
  const google = {
    userId: "u1",
    providerId: "google",
    accountId: "1234567890",
    accessToken: "ya29.secret-access",
    refreshToken: "1//secret-refresh",
    idToken: "eyJ.secret.id",
    accessTokenExpiresAt: new Date("2030-01-01"),
    refreshTokenExpiresAt: new Date("2031-01-01"),
    scope: "openid,email,profile",
  };

  it("nulls every token and expiry, and keeps everything else", () => {
    const out = stripOAuthTokens(google);
    for (const f of OAUTH_TOKEN_FIELDS) expect(out[f], f).toBeNull();
    expect(out).toMatchObject({ userId: "u1", providerId: "google", accountId: "1234567890", scope: "openid,email,profile" });
    expect(JSON.stringify(out)).not.toMatch(/secret/);
  });

  it("does not add fields that were not there (a credential account has no tokens) and does not mutate its input", () => {
    const credential = { userId: "u1", providerId: "credential", accountId: "u1", password: "hash" };
    expect(stripOAuthTokens(credential)).toEqual(credential);
    stripOAuthTokens(google);
    expect(google.accessToken).toBe("ya29.secret-access");
  });
});

describe("the auth instance applies it to account rows", () => {
  beforeEach(() => {
    vi.resetModules();
    setEnv();
    // The database guard wants a dev URL in tests. This pool is only constructed, never connected to (no query runs here).
    delete process.env.DATABASE_URL;
    process.env.DEV_DATABASE_URL = "postgresql://dev.invalid/db";
  });

  it("registers create and update hooks that null the tokens", async () => {
    const { getAuth } = await import("@/server/auth");
    const hooks = (getAuth().options as unknown as { databaseHooks?: { account?: Record<"create" | "update", { before: (a: Record<string, unknown>) => Promise<{ data: Record<string, unknown> }> }> } }).databaseHooks?.account;
    expect(hooks, "account hooks are registered").toBeDefined();
    for (const op of ["create", "update"] as const) {
      const { data } = await hooks![op].before({ providerId: "google", accountId: "9", accessToken: "a", refreshToken: "r", idToken: "i" });
      expect(data).toMatchObject({ accessToken: null, refreshToken: null, idToken: null, providerId: "google" });
    }
  });
});
