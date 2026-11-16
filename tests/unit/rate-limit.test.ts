import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { rateLimit } from "@/server/db/schema";
import type { AppDb } from "@/server/db/types";
import { createTestDb } from "../helpers/pglite";
import { setEnv } from "../helpers/env";

let db: AppDb;
let close: () => Promise<void>;
beforeAll(async () => ({ db, close } = await createTestDb()));
afterAll(() => close());
beforeEach(async () => {
  vi.resetModules();
  setEnv();
  await db.delete(rateLimit);
});

const T0 = 3_000_000_000_000;

describe("hit (fixed window on the rate_limit table)", () => {
  it("allows up to the limit, then blocks with a retryAfter", async () => {
    const { hit } = await import("@/server/rate-limit");
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await hit(db, { key: "search:ip:1.2.3.4", limit: 3, windowSec: 60, now: T0 + i * 1000 }));
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false]);
    expect(results.map((r) => r.count)).toEqual([1, 2, 3, 4]);
    expect(results[3].retryAfter).toBe(57); // window started at T0, now = T0 + 3 s
  });

  it("starts a new window once the old one has passed", async () => {
    const { hit } = await import("@/server/rate-limit");
    for (let i = 0; i < 5; i++) await hit(db, { key: "k", limit: 3, windowSec: 60, now: T0 });
    const next = await hit(db, { key: "k", limit: 3, windowSec: 60, now: T0 + 60_000 });
    expect(next).toMatchObject({ allowed: true, count: 1 });
  });

  it("keeps IPs and users in separate buckets", async () => {
    const { hit } = await import("@/server/rate-limit");
    for (let i = 0; i < 4; i++) await hit(db, { key: "search:ip:9.9.9.9", limit: 3, windowSec: 60, now: T0 });
    expect((await hit(db, { key: "search:ip:8.8.8.8", limit: 3, windowSec: 60, now: T0 })).allowed).toBe(true);
    expect((await hit(db, { key: "search:user:abc", limit: 3, windowSec: 60, now: T0 })).allowed).toBe(true);
    expect((await hit(db, { key: "image:ip:9.9.9.9", limit: 3, windowSec: 60, now: T0 })).allowed).toBe(true);
  });

  it("is atomic under concurrency: exactly `limit` of many parallel hits are allowed", async () => {
    const { hit } = await import("@/server/rate-limit");
    const rs = await Promise.all(Array.from({ length: 40 }, () => hit(db, { key: "burst", limit: 10, windowSec: 60, now: T0 })));
    expect(rs.filter((r) => r.allowed)).toHaveLength(10);
  });

  it("namespaces keys so it cannot collide with Better Auth rows", async () => {
    const { hit } = await import("@/server/rate-limit");
    await hit(db, { key: "search:ip:1.1.1.1", limit: 1, windowSec: 60, now: T0 });
    const rows = await db.select({ key: rateLimit.key }).from(rateLimit);
    expect(rows.map((r) => r.key)).toEqual(["app:search:ip:1.1.1.1"]);
  });
});

describe("clientIp", () => {
  it("prefers the platform header, then the first X-Forwarded-For entry, then X-Real-IP", async () => {
    const { clientIp } = await import("@/server/rate-limit");
    expect(clientIp(new Headers({ "x-vercel-forwarded-for": "5.5.5.5", "x-forwarded-for": "6.6.6.6" }))).toBe("5.5.5.5");
    expect(clientIp(new Headers({ "x-forwarded-for": "6.6.6.6, 10.0.0.1" }))).toBe("6.6.6.6");
    expect(clientIp(new Headers({ "x-real-ip": "7.7.7.7" }))).toBe("7.7.7.7");
    expect(clientIp(new Headers())).toBe("unknown");
  });

  it("accepts only valid IPs, so a forged header cannot inject junk into limiter keys", async () => {
    const { clientIp } = await import("@/server/rate-limit");
    expect(clientIp(new Headers({ "x-forwarded-for": "1.2.3.4'; drop table--" }))).toBe("unknown");
    expect(clientIp(new Headers({ "x-forwarded-for": "not-an-ip, 6.6.6.6" }))).toBe("unknown"); // first entry is what we trust
    expect(clientIp(new Headers({ "x-forwarded-for": "garbage", "x-real-ip": "7.7.7.7" }))).toBe("7.7.7.7");
    expect(clientIp(new Headers({ "x-forwarded-for": "2001:DB8::1" }))).toBe("2001:db8::1");
  });
});
