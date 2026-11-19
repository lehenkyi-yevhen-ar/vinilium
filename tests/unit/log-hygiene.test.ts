import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { AppDb } from "@/server/db/types";
import { rateLimit } from "@/server/db/schema";
import { createTestDb } from "../helpers/pglite";
import { setEnv } from "../helpers/env";

/**
 * What the server writes to its log. Logs hold IP addresses and paths and are read by one operator, but they must never hold an email
 * address, a link with a token, a key, a password or a stack. The rule is enforced two ways: every log statement in src/ must be on a
 * short, reviewed list (a new one fails this test until someone reads it), and the two lines people ask about are exercised.
 */

const SRC = path.resolve(__dirname, "../../src");
const files: string[] = [];
const walk = (d: string) => {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const full = path.join(d, e.name);
    if (e.isDirectory()) walk(full);
    else if (/\.(ts|tsx)$/.test(e.name)) files.push(full);
  }
};
walk(SRC);

/** Every console call in src/, with the first part of its message. */
const calls = files.flatMap((f) => {
  const text = readFileSync(f, "utf8");
  return [...text.matchAll(/console\.(log|warn|error|info|debug)\(\s*`?"?([^\n]{0,60})/g)].map((m) => ({ file: path.relative(SRC, f).replaceAll("\\", "/"), level: m[1], start: m[2] }));
});

const REVIEWED: Array<{ file: string; startsWith: string; why: string }> = [
  { file: "app/api/csp-report/route.ts", startsWith: "[csp-report]", why: "directive, blocked address, page and source with the query string removed; sanitised by parseCspReports" },
  { file: "server/auth/session.ts", startsWith: "[auth] getSession failed", why: "error name and code only" },
  { file: "server/email/index.ts", startsWith: "[email] ${opts.kind} email FAILED", why: "provider, reason and status only" },
  { file: "server/email/index.ts", startsWith: "[email:dev]", why: "development only, never reached in production (no provider + production returns misconfigured first)" },
  { file: "server/email/index.ts", startsWith: "\n[email:dev]", why: "same statement (multi-line template)" },
  { file: "server/metrics.ts", startsWith: "line", why: "one line a minute of event counts: no person, address, query or content (tests/unit/metrics.test.ts)" },
];

describe("log statements in src/", () => {
  it("every one is on the reviewed list", () => {
    const unknown = calls.filter((c) => !REVIEWED.some((r) => r.file === c.file && (c.start.startsWith(r.startsWith) || r.startsWith.startsWith(c.start.trim()) || c.start.trim() === "")));
    expect(unknown, "a new console statement: read it, then add it to REVIEWED with the reason it is safe").toEqual([]);
  });

  it("there are no console statements in client components (they would run in people's browsers)", () => {
    for (const f of files) {
      const text = readFileSync(f, "utf8");
      if (/^["']use client["']/.test(text.trimStart())) expect(text, path.relative(SRC, f)).not.toMatch(/console\./);
    }
  });

  it("none of them interpolates a request body, a header value, a cookie, an address or a password", () => {
    for (const f of files) {
      const text = readFileSync(f, "utf8");
      for (const m of text.matchAll(/console\.(?:log|warn|error|info|debug)\(([\s\S]*?)\);/g)) {
        const statement = m[1];
        if (f.replaceAll("\\", "/").endsWith("server/email/index.ts") && statement.includes("[email:dev]")) continue; // development only, see above
        expect(statement, `${path.relative(SRC, f)}: ${statement.slice(0, 80)}`).not.toMatch(/request\.|headers|cookie|password|\.email\b|\.url\b|\.text\b|apiKey|api-key|token|secret|\berror\b(?!\?)/i);
      }
    }
  });
});

let db: AppDb;
let close: () => Promise<void>;
vi.mock("@/server/db", async () => ({ getDb: () => db, schema: await import("@/server/db/schema") }));

describe("the [csp-report] line", () => {
  beforeAll(async () => ({ db, close } = await createTestDb()));
  afterAll(() => close());
  beforeEach(async () => {
    vi.resetModules();
    setEnv();
    await db.delete(rateLimit);
  });
  afterEach(() => vi.restoreAllMocks());

  const post = async (body: unknown, headers: Record<string, string> = {}) => {
    const { POST } = await import("@/app/api/csp-report/route");
    return POST(new Request("http://localhost/api/csp-report", { method: "POST", headers: { "content-type": "application/csp-report", "x-forwarded-for": "198.51.100.5", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) }));
  };

  it("logs the directive and addresses WITHOUT query strings, fragments, tokens, control characters or the sample", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await post({
      "csp-report": {
        "effective-directive": "script-src-elem",
        "blocked-uri": "https://evil.example/x.js?token=SECRET-TOKEN-123#frag",
        "document-uri": "https://vinilium.example/en/reset-password?token=SECRET-RESET-456",
        "source-file": "https://vinilium.example/_next/static/a.js?v=1",
        "script-sample": "document.cookie = 'SECRET-COOKIE'",
        "original-policy": "default-src 'self'",
      },
    });
    expect(res.status).toBe(204);
    expect(warn).toHaveBeenCalledTimes(1);
    const line = String(warn.mock.calls[0][0]);
    expect(line).toBe("[csp-report] script-src-elem blocked=https://evil.example/x.js page=https://vinilium.example/en/reset-password source=https://vinilium.example/_next/static/a.js");
    expect(line).not.toMatch(/SECRET|token=|frag|cookie/i);
    expect(warn.mock.calls[0]).toHaveLength(1); // one string, no object (an object would print whole)
  });

  it("cannot be used to forge log lines, to fill the log, or to learn anything from the answer", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect((await post({ "csp-report": { "effective-directive": "img-src", "blocked-uri": "x\n[email] verify email FAILED provider=brevo reason=auth\u0000" } })).status).toBe(204);
    expect(String(warn.mock.calls[0][0])).not.toMatch(/\n/);
    // junk and oversized bodies are answered the same and log nothing
    warn.mockClear();
    for (const body of ["not json", "[]", "null", JSON.stringify({ a: "b".repeat(20_000) })]) {
      const res = await post(body);
      expect(res.status).toBe(204);
      expect(await res.text()).toBe("");
    }
    expect(warn).not.toHaveBeenCalled();
    const big = await post("x".repeat(100), { "content-length": "999999" });
    expect(big.status).toBe(204);
    // more than the rate limit from one address: still 204, nothing more is logged
    warn.mockClear();
    for (let i = 0; i < 40; i++) await post({ "csp-report": { "effective-directive": "img-src", "blocked-uri": "https://evil.example/a.png" } }, { "x-forwarded-for": "198.51.100.99" });
    expect(warn.mock.calls.length).toBeLessThanOrEqual(30);
  });
});
