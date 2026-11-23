import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppDb } from "@/server/db/types";
import { createTestDb } from "../helpers/pglite";
import { setEnv } from "../helpers/env";
import pkg from "../../package.json";
import { FAKE_CRON_SECRET } from "../helpers/fake-secrets";

/** /api/health: version and database reachability, nothing else. */

let db: AppDb;
let close: () => Promise<void>;
let broken: ((q: unknown) => Promise<unknown>) | null = null;
vi.mock("@/server/db", () => ({
  getDb: () => (broken ? { execute: broken } : db),
}));

beforeAll(async () => ({ db, close } = await createTestDb()));
afterAll(() => close());
beforeEach(async () => {
  vi.resetModules();
  setEnv({ BREVO_API_KEY: "SECRET-BREVO", DISCOGS_CONSUMER_SECRET: "SECRET-DISCOGS", CRON_SECRET: FAKE_CRON_SECRET });
  broken = null;
  const { resetHealthMemory } = await import("@/server/health");
  resetHealthMemory();
});

describe("GET /api/health", () => {
  it("answers 200 {status ok, version, db up} when the database answers, uncached", async () => {
    const { GET } = await import("@/app/api/health/route");
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ status: "ok", version: pkg.version, db: "up" });
  });

  it("answers 503 {status degraded, db down} when the database fails, and says nothing about why", async () => {
    broken = async () => {
      throw new Error("connect ECONNREFUSED postgresql://user:SECRET-PASSWORD@db.internal.example/db");
    };
    const { GET } = await import("@/app/api/health/route");
    const res = await GET();
    expect(res.status).toBe(503);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ status: "degraded", version: pkg.version, db: "down" });
    expect(text).not.toMatch(/SECRET|ECONN|postgres|internal/);
  });

  it("gives up on a database that does not answer in time", async () => {
    const { checkHealth } = await import("@/server/health");
    const hang = { execute: () => new Promise(() => {}) } as unknown as Pick<AppDb, "execute">;
    // The behaviour is that the answer ARRIVES and says "degraded" although the query never settles. (No stopwatch: a slow runner must not
    // fail this; a check that really hangs would stop at the test's own timeout.)
    expect(await checkHealth(hang, { timeoutMs: 50 })).toMatchObject({ status: "degraded", db: "down" });
  });

  it("reports only status, version and db: no environment, secret, person or Discogs data", async () => {
    const { GET } = await import("@/app/api/health/route");
    const text = await (await GET()).text();
    expect(Object.keys(JSON.parse(text)).sort()).toEqual(["db", "status", "version"]);
    expect(text).not.toMatch(/SECRET|@|postgres|DISCOGS|BREVO|CRON|token|key/i);
  });

  it("does not call Discogs (or anything but the database)", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { GET } = await import("@/app/api/health/route");
    await GET();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("remembers the answer for 30 seconds, so polling it cannot become a stream of queries", async () => {
    const calls = vi.fn(async () => [{ "?column?": 1 }]);
    broken = calls;
    const { checkHealth, HEALTH_CACHE_MS } = await import("@/server/health");
    const fake = { execute: calls } as unknown as Pick<AppDb, "execute">;
    const t = 1_000_000;
    await checkHealth(fake, { now: t });
    await checkHealth(fake, { now: t + 1000 });
    await checkHealth(fake, { now: t + HEALTH_CACHE_MS - 1 });
    expect(calls).toHaveBeenCalledTimes(1);
    await checkHealth(fake, { now: t + HEALTH_CACHE_MS });
    expect(calls).toHaveBeenCalledTimes(2);
  });

  it("HEAD answers the same status with no body", async () => {
    const { HEAD } = await import("@/app/api/health/route");
    const res = await HEAD();
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("");
  });
});
