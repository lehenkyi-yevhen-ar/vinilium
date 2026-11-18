import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "@/server/db/schema";
import type { AppDb } from "@/server/db/types";
import { createTestDb } from "../helpers/pglite";
import { setEnv } from "../helpers/env";

/**
 * The REAL Better Auth instance (production mode, https origin) on PGlite: redirect and callback parameters, CSRF (Origin), session
 * cookie flags and the auth rate limits. Nothing here sends an email (no provider is configured; the failure is logged, not thrown).
 */

// Better Auth skips its origin checks and rate limits in "test mode" (NODE_ENV=test or TEST=true), and reads NODE_ENV when it is first
// imported, which vitest cannot repeat for a package in node_modules: production mode has to be in place before anything is imported.
vi.hoisted(() => {
  (process.env as Record<string, string | undefined>).NODE_ENV = "production";
  delete process.env.TEST; // vitest sets TEST=true, which Better Auth also reads as "test mode" (no origin check, no rate limit)
});

const ORIGIN = "https://vinilium.example";
let db: AppDb;
let close: () => Promise<void>;
vi.mock("@/server/db", () => ({ getDb: () => db, schema }));

beforeAll(async () => ({ db, close } = await createTestDb()));
afterAll(() => close());

beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv("NODE_ENV", "production");
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  setEnv({ BETTER_AUTH_URL: ORIGIN, NEXT_PUBLIC_APP_URL: ORIGIN });
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
  await db.delete(schema.rateLimit);
});

let ipCounter = 0;
async function call(path: string, body: unknown, headers: Record<string, string> = {}) {
  const { getAuth } = await import("@/server/auth");
  const req = new Request(`${ORIGIN}/api/auth${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN, "x-forwarded-for": `198.51.100.${(ipCounter++ % 200) + 1}`, ...headers },
    body: JSON.stringify(body),
  });
  return getAuth().handler(req);
}
const json = async (res: Response) => (await res.json().catch(() => null)) as Record<string, unknown> | null;

describe("redirect and callback parameters (open redirect)", () => {
  const evil = ["https://evil.example/x", "//evil.example", "http://vinilium.example.evil.example/", "https://vinilium.example.evil.example/", "javascript:alert(1)", "https://evil.example\\@vinilium.example", "/\\evil.example"];

  it.each(evil)("send-verification-email refuses callbackURL %s", async (callbackURL) => {
    const res = await call("/send-verification-email", { email: "someone@example.test", callbackURL });
    expect(res.status).toBe(403);
    expect(JSON.stringify(await json(res))).toMatch(/Invalid callbackURL/);
  });

  it.each(evil)("request-password-reset refuses redirectTo %s", async (redirectTo) => {
    const res = await call("/request-password-reset", { email: "someone@example.test", redirectTo });
    expect(res.status).toBe(403);
    expect(JSON.stringify(await json(res))).toMatch(/Invalid redirectURL/i);
  });

  it.each(evil)("sign-up refuses callbackURL %s", async (callbackURL) => {
    const res = await call("/sign-up/email", { name: "A", email: `a-${ipCounter}@example.test`, password: "Password-12345", callbackURL });
    expect(res.status).toBe(403);
    expect(JSON.stringify(await json(res))).toMatch(/Invalid callbackURL/);
  });

  it("sign-in refuses callbackURL, errorCallbackURL-style parameters and a newUserCallbackURL on another site", async () => {
    for (const field of ["callbackURL", "errorCallbackURL", "newUserCallbackURL"]) {
      const res = await call("/sign-in/email", { email: "someone@example.test", password: "Password-12345", [field]: "https://evil.example/x" });
      expect(res.status, field).toBe(403);
    }
  });

  it("accepts our own relative and same-origin callbacks (so the checks above are not just refusing everything)", async () => {
    for (const ok of ["/en/verify-email/done", `${ORIGIN}/uk/verify-email/done`]) {
      const res = await call("/send-verification-email", { email: "someone@example.test", callbackURL: ok });
      expect(res.status, ok).toBe(200);
    }
    const reset = await call("/request-password-reset", { email: "someone@example.test", redirectTo: "/en/reset-password" });
    expect(reset.status).toBe(200);
  });
});

describe("CSRF: the Origin of a state-changing request", () => {
  it("refuses a POST that a page on another site made, even with a session cookie", async () => {
    for (const origin of ["https://evil.example", "http://vinilium.example", "null"]) {
      const res = await call("/sign-out", {}, { origin, cookie: "__Secure-better-auth.session_token=x" });
      expect(res.status, origin).toBe(403);
      expect(JSON.stringify(await json(res))).toMatch(/Invalid origin|Missing or null Origin/i);
    }
  });

  it("refuses to delete an account for a request from another site", async () => {
    const res = await call("/delete-user", { password: "x" }, { origin: "https://evil.example", cookie: "__Secure-better-auth.session_token=x" });
    expect(res.status).toBe(403);
  });
});

describe("the session cookie (production mode, https)", () => {
  async function signedInResponse() {
    const email = `cookie-${ipCounter}@example.test`;
    const up = await call("/sign-up/email", { name: "Cookie Test", email, password: "Password-12345" });
    expect(up.status).toBe(200);
    await db.update(schema.user).set({ emailVerified: true }).where(eq(schema.user.email, email)); // a test has no mailbox
    return call("/sign-in/email", { email, password: "Password-12345" });
  }

  it("is Secure, HttpOnly, SameSite=Lax, path /, with a bounded lifetime and the __Secure- prefix", async () => {
    const res = await signedInResponse();
    expect(res.status).toBe(200);
    const cookies = res.headers.getSetCookie();
    const session = cookies.find((c) => /session_token/.test(c));
    expect(session, "a session cookie is set").toBeTruthy();
    expect(session).toMatch(/^__Secure-better-auth\.session_token=/);
    expect(session).toMatch(/;\s*Secure/i);
    expect(session).toMatch(/;\s*HttpOnly/i);
    expect(session).toMatch(/;\s*SameSite=Lax/i);
    expect(session).toMatch(/;\s*Path=\//i);
    const maxAge = Number(session!.match(/Max-Age=(\d+)/i)?.[1]);
    expect(maxAge).toBeGreaterThan(0);
    expect(maxAge).toBeLessThanOrEqual(60 * 60 * 24 * 30); // at most 30 days
    expect(session).not.toMatch(/Domain=/i); // host-only: never shared with subdomains
  });

  it("a new sign-in gets a NEW token (no session fixation) and the token is not the user id or the email", async () => {
    const email = `fixation-${ipCounter}@example.test`;
    await call("/sign-up/email", { name: "Fix", email, password: "Password-12345" });
    await db.update(schema.user).set({ emailVerified: true }).where(eq(schema.user.email, email));
    const token = async (cookie?: string) => {
      const res = await call("/sign-in/email", { email, password: "Password-12345" }, cookie ? { cookie } : {});
      return decodeURIComponent(res.headers.getSetCookie().find((c) => /session_token/.test(c))!.split(";")[0].split("=").slice(1).join("="));
    };
    const planted = "attacker-chosen-token";
    const a = await token(`__Secure-better-auth.session_token=${planted}`);
    const b = await token();
    expect(a).not.toContain(planted);
    expect(a).not.toBe(b);
    const rows = await db.select().from(schema.session);
    expect(rows.some((r) => r.token === planted)).toBe(false);
  });

  it("nothing in the sign-in answer contains the password hash", async () => {
    const res = await signedInResponse();
    const body = JSON.stringify(await json(res));
    expect(body).not.toMatch(/password|scrypt|\$argon|hash/i);
  });
});

describe("auth rate limits (stored in Postgres)", () => {
  it("sign-in: the 9th attempt in a minute from one address is a 429 with a retry time", async () => {
    const headers = { "x-forwarded-for": "203.0.113.9" };
    const statuses: number[] = [];
    let last: Response | null = null;
    for (let i = 0; i < 10; i++) {
      last = await call("/sign-in/email", { email: "nobody@example.test", password: "Password-12345" }, headers);
      statuses.push(last.status);
    }
    expect(statuses.slice(0, 8).every((s) => s !== 429)).toBe(true);
    expect(statuses.slice(8)).toEqual([429, 429]);
    const retry = Number(last!.headers.get("x-retry-after"));
    expect(retry).toBeGreaterThanOrEqual(1);
    expect(retry).toBeLessThanOrEqual(60);
    // another address is not affected
    expect((await call("/sign-in/email", { email: "nobody@example.test", password: "Password-12345" }, { "x-forwarded-for": "203.0.113.10" })).status).not.toBe(429);
  });

  it("the route adds the standard Retry-After next to Better Auth's X-Retry-After", async () => {
    const { POST } = await import("@/app/api/auth/[...all]/route");
    let last: Response | null = null;
    for (let i = 0; i < 10; i++) {
      last = await POST(new Request(`${ORIGIN}/api/auth/sign-in/email`, { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN, "x-forwarded-for": "203.0.113.30" }, body: JSON.stringify({ email: "nobody@example.test", password: "Password-12345" }) }));
    }
    expect(last!.status).toBe(429);
    expect(Number(last!.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
    expect(last!.headers.get("retry-after")).toBe(last!.headers.get("x-retry-after"));
  });

  it("withRetryAfter leaves other responses alone", async () => {
    const { withRetryAfter } = await import("@/server/auth/retry-after");
    const ok = new Response("{}", { status: 200, headers: { "x-retry-after": "5" } });
    expect(withRetryAfter(ok).headers.get("retry-after")).toBeNull();
    const already = new Response("{}", { status: 429, headers: { "x-retry-after": "5", "retry-after": "7" } });
    expect(withRetryAfter(already).headers.get("retry-after")).toBe("7");
    expect(withRetryAfter(new Response("{}", { status: 429 })).headers.get("retry-after")).toBeNull();
  });

  it("password reset and verification resend are limited to 3 a minute, sign-up to 5", async () => {
    const run = async (path: string, body: unknown, allowed: number, ip: string) => {
      const out: number[] = [];
      for (let i = 0; i < allowed + 1; i++) out.push((await call(path, body, { "x-forwarded-for": ip })).status);
      expect(out.slice(0, allowed).every((s) => s !== 429), path).toBe(true);
      expect(out[allowed], path).toBe(429);
    };
    await run("/request-password-reset", { email: "x@example.test", redirectTo: "/en/reset-password" }, 3, "203.0.113.20");
    await run("/send-verification-email", { email: "x@example.test", callbackURL: "/en/verify-email/done" }, 3, "203.0.113.21");
  });
});
