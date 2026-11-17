import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `next/server` -> after() is only valid inside a request; sendAuthEmail itself doesn't use it.
vi.mock("next/server", () => ({ after: (fn: () => void) => fn() }));

beforeEach(() => {
  vi.resetModules();
  process.env.DATABASE_URL = "postgresql://localhost/db";
  process.env.BETTER_AUTH_SECRET = "0123456789abcdef0123456789abcdef";
  process.env.BETTER_AUTH_URL = "http://localhost:3000";
  delete process.env.RESEND_API_KEY;
  delete process.env.BREVO_API_KEY;
  delete process.env.EMAIL_PROVIDER;
});
afterEach(() => vi.restoreAllMocks());

describe("normalizeLocale", () => {
  it("keeps supported locales and falls back to the default", async () => {
    const { normalizeLocale } = await import("@/server/email");
    expect(normalizeLocale("uk")).toBe("uk");
    expect(normalizeLocale("nb")).toBe("nb");
    expect(normalizeLocale("de")).toBe("en");
    expect(normalizeLocale(undefined)).toBe("en");
    expect(normalizeLocale({ evil: true })).toBe("en");
  });
});

describe("sendAuthEmail (dev mode, no provider key)", () => {
  it("prints the link instead of sending, in the user's language", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const { sendAuthEmail } = await import("@/server/email");
    await sendAuthEmail({ kind: "verify", to: "a@b.co", name: "Оля", locale: "uk", url: "http://localhost:3000/v?t=1" });
    const out = log.mock.calls.flat().join("\n");
    expect(out).toContain("http://localhost:3000/v?t=1");
    expect(out).toContain("Підтвердьте пошту");
  });

  it("refuses to run without a provider in production (links are credentials)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { sendAuthEmail } = await import("@/server/email");
    await expect(
      sendAuthEmail({ kind: "reset", to: "a@b.co", name: "A", locale: "en", url: "http://x/y" }),
    ).rejects.toThrow("email not sent: none misconfigured");
    vi.unstubAllEnvs();
  });
});
