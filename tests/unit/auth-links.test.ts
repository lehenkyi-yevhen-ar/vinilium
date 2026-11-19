import { beforeEach, describe, expect, it } from "vitest";
import { FAKE_AUTH_SECRET } from "../helpers/fake-secrets";

beforeEach(() => {
  process.env.DATABASE_URL = "postgresql://u:p@localhost/db";
  process.env.BETTER_AUTH_SECRET = FAKE_AUTH_SECRET;
  process.env.BETTER_AUTH_URL = "http://localhost:3000";
});

describe("localizeVerificationUrl", () => {
  const base = "http://localhost:3000/api/auth/verify-email?token=abc";

  it("rewrites the bare '/' callback (sign-in resend) to the user's localized done page", async () => {
    const { localizeVerificationUrl } = await import("@/server/auth");
    const out = new URL(localizeVerificationUrl(`${base}&callbackURL=%2F`, "uk"));
    expect(out.searchParams.get("callbackURL")).toBe("/uk/verify-email/done");
    expect(out.searchParams.get("token")).toBe("abc");
  });

  it("falls back to the default locale for unknown values", async () => {
    const { localizeVerificationUrl } = await import("@/server/auth");
    const out = new URL(localizeVerificationUrl(`${base}&callbackURL=%2F`, "xx"));
    expect(out.searchParams.get("callbackURL")).toBe("/en/verify-email/done");
  });

  it("leaves an explicit callback (sign-up, resend button) untouched", async () => {
    const { localizeVerificationUrl } = await import("@/server/auth");
    const url = `${base}&callbackURL=%2Fnb%2Fverify-email%2Fdone`;
    expect(localizeVerificationUrl(url, "uk")).toBe(url);
  });
});
