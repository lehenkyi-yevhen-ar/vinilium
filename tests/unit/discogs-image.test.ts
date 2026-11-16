import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { discogsBucket } from "@/server/db/schema";
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
  await db.delete(discogsBucket);
});

const ALLOW = { hosts: ["i.discogs.com", "img.discogs.com", "s.discogs.com"] as const, extraOrigin: null };

describe("validateImageUrl: host allow-list (SSRF protection)", () => {
  it("accepts https URLs on the exact Discogs image hosts", async () => {
    const { validateImageUrl } = await import("@/server/discogs/image");
    for (const ok of [
      "https://i.discogs.com/abc/rs:fit/g:sm/q:90/w:600/h:600/cover.jpeg",
      "https://img.discogs.com/x/y.jpg?z=1",
      "https://s.discogs.com/a.png",
      "https://I.DISCOGS.COM/upper.jpg", // hostnames are case-insensitive
    ]) {
      expect(validateImageUrl(ok, ALLOW), ok).not.toBeNull();
    }
  });

  it("rejects everything else", async () => {
    const { validateImageUrl } = await import("@/server/discogs/image");
    const bad = [
      "http://i.discogs.com/a.jpg", // not https
      "https://evil.example/a.jpg",
      "https://i.discogs.com.evil.example/a.jpg", // suffix trick
      "https://evil.example/i.discogs.com/a.jpg", // host in path
      "https://i.discogs.com@evil.example/a.jpg", // userinfo trick
      "https://user:pw@i.discogs.com/a.jpg", // credentials
      "https://i.discogs.com:8443/a.jpg", // non-default port
      "https://i.discogs.com:443/a.jpg", // explicit port is normalised away, so this is accepted below
      "https://sub.i.discogs.com/a.jpg", // no wildcard subdomains
      "https://discogs.com/a.jpg", // apex is not an image host
      "https://api.discogs.com/releases/1", // the API is not an image host
      "https://www.discogs.com/a.jpg",
      "https://localhost/a.jpg",
      "https://127.0.0.1/a.jpg",
      "https://[::1]/a.jpg",
      "https://169.254.169.254/latest/meta-data/", // cloud metadata
      "https://2130706433/a.jpg", // decimal IP for 127.0.0.1
      "https://0x7f000001/a.jpg",
      "file:///etc/passwd",
      "ftp://i.discogs.com/a.jpg",
      "javascript:alert(1)",
      "data:image/png;base64,AAAA",
      "//i.discogs.com/a.jpg", // scheme-relative
      "/relative/a.jpg",
      "",
      "not a url",
      "https://i.discogs.com./a.jpg", // trailing-dot host
      "https://" + "a".repeat(3000) + ".com/x.jpg",
    ];
    for (const url of bad) {
      const out = validateImageUrl(url, ALLOW);
      if (url === "https://i.discogs.com:443/a.jpg") expect(out).not.toBeNull(); // default port is fine
      else expect(out, url).toBeNull();
    }
  });

  it("a backslash trick resolves to the REAL host, and we fetch the parsed URL, not the raw string", async () => {
    const { validateImageUrl } = await import("@/server/discogs/image");
    const u = validateImageUrl(String.raw`https://i.discogs.com\@evil.example/a.jpg`, ALLOW);
    expect(u?.hostname).toBe("i.discogs.com");
    expect(u?.toString()).toBe("https://i.discogs.com/@evil.example/a.jpg");
  });

  it("only trusts the extra (mock) origin when explicitly configured", async () => {
    const { validateImageUrl } = await import("@/server/discogs/image");
    expect(validateImageUrl("http://localhost:3201/img/a.jpg", ALLOW)).toBeNull();
    expect(validateImageUrl("http://localhost:3201/img/a.jpg", { ...ALLOW, extraOrigin: "http://localhost:3201" })).not.toBeNull();
    expect(validateImageUrl("http://localhost:9999/img/a.jpg", { ...ALLOW, extraOrigin: "http://localhost:3201" })).toBeNull();
    expect(validateImageUrl("http://user:pw@localhost:3201/a.jpg", { ...ALLOW, extraOrigin: "http://localhost:3201" })).toBeNull();
  });

  it("the production allow-list is exactly three hosts and does not include the override", async () => {
    const cfg = await import("@/server/discogs/config");
    expect(cfg.DISCOGS_IMAGE_HOSTS).toEqual(["i.discogs.com", "img.discogs.com", "s.discogs.com"]);
    expect(cfg.allowedImageOrigins().extraOrigin).toBeNull();
    vi.resetModules();
    setEnv({ DISCOGS_API_BASE: "http://localhost:3201" });
    expect((await import("@/server/discogs/config")).allowedImageOrigins().extraOrigin).toBe("http://localhost:3201");
  });
});

describe("toProxyUrl", () => {
  it("rewrites allowed URLs to the same-origin proxy and drops anything else", async () => {
    const { toProxyUrl } = await import("@/server/discogs/image");
    const out = toProxyUrl("https://i.discogs.com/a/b.jpg?x=1&y=2", ALLOW)!;
    expect(out.startsWith("/api/discogs/image?u=")).toBe(true);
    expect(new URL(out, "http://x").searchParams.get("u")).toBe("https://i.discogs.com/a/b.jpg?x=1&y=2");
    expect(toProxyUrl("https://evil.example/a.jpg", ALLOW)).toBeNull();
    expect(toProxyUrl("https://st.discogs.com/images/spacer.gif", ALLOW)).toBeNull();
    expect(toProxyUrl(null, ALLOW)).toBeNull();
    expect(toProxyUrl("", ALLOW)).toBeNull();
  });
});

describe("proxyImage", () => {
  const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
  const img = (init: ResponseInit = {}) => new Response(bytes, { status: 200, headers: { "content-type": "image/jpeg", ...(init.headers as object) }, ...init });
  const run = async (fetchImpl: typeof fetch, url = "https://i.discogs.com/a/cover.jpg", now = () => 9_000_000) => {
    const { proxyImage } = await import("@/server/discogs/image");
    return proxyImage(url, { db, fetchImpl, now });
  };

  it("streams the image with the right headers, authenticated, and cacheable for exactly the TTL", async () => {
    const f = vi.fn(async (..._a: unknown[]) => img());
    const out = await run(f as unknown as typeof fetch);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(new Uint8Array(await out.response.arrayBuffer())).toEqual(bytes);
    expect(out.response.headers.get("content-type")).toBe("image/jpeg");
    expect(out.response.headers.get("cache-control")).toBe("public, max-age=21600, s-maxage=21600");
    expect(out.response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(out.response.headers.get("content-security-policy")).toContain("sandbox");

    const init = f.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe("Discogs key=test-key, secret=test-secret");
    expect(init.redirect).toBe("manual");
  });

  it("Cache-Control follows DISCOGS_CACHE_TTL_SECONDS", async () => {
    vi.resetModules();
    setEnv({ DISCOGS_CACHE_TTL_SECONDS: "120" });
    const out = await run((async () => img()) as unknown as typeof fetch);
    expect(out.ok && out.response.headers.get("cache-control")).toBe("public, max-age=120, s-maxage=120");
  });

  it("refuses a non-allowed URL without calling out", async () => {
    const f = vi.fn();
    expect(await run(f as unknown as typeof fetch, "https://evil.example/a.jpg")).toEqual({ ok: false, kind: "bad_request" });
    expect(await run(f as unknown as typeof fetch, "http://169.254.169.254/")).toEqual({ ok: false, kind: "bad_request" });
    expect(f).not.toHaveBeenCalled();
  });

  it("follows a redirect only to another allowed host", async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 302, headers: { location: "https://img.discogs.com/real.jpg" } }))
      .mockResolvedValueOnce(img());
    const out = await run(f as unknown as typeof fetch);
    expect(out.ok).toBe(true);
    expect(String(f.mock.calls[1][0])).toBe("https://img.discogs.com/real.jpg");
  });

  it("refuses a redirect to a non-allowed host and never sends credentials there", async () => {
    const f = vi.fn().mockResolvedValueOnce(new Response("", { status: 302, headers: { location: "https://evil.example/steal.jpg" } }));
    expect(await run(f as unknown as typeof fetch)).toEqual({ ok: false, kind: "bad_request" });
    expect(f).toHaveBeenCalledTimes(1); // the evil URL was never requested
  });

  it("refuses a redirect to an internal address", async () => {
    const f = vi.fn().mockResolvedValueOnce(new Response("", { status: 302, headers: { location: "http://169.254.169.254/latest/" } }));
    expect(await run(f as unknown as typeof fetch)).toEqual({ ok: false, kind: "bad_request" });
  });

  it("handles a 429 gracefully: reports throttled with retryAfter and blocks the shared bucket", async () => {
    const f = vi.fn(async () => new Response("", { status: 429, headers: { "retry-after": "30" } }));
    const out = await run(f as unknown as typeof fetch);
    expect(out).toEqual({ ok: false, kind: "throttled", retryAfter: 30 });
    // the next image request is refused locally, without a network call
    const again = await run(f as unknown as typeof fetch);
    expect(again.ok).toBe(false);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("never dips into the reserve kept for API calls", async () => {
    const { acquireToken } = await import("@/server/discogs/token-bucket");
    const { bucketId } = await import("@/server/discogs/config");
    for (let i = 0; i < 19; i++) await acquireToken(db, { id: bucketId(), now: 9_000_000 }); // 6 of 25 left (< 25% reserve)
    const f = vi.fn();
    const out = await run(f as unknown as typeof fetch);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.kind).toBe("throttled");
    expect(f).not.toHaveBeenCalled();
    expect((await acquireToken(db, { id: bucketId(), now: 9_000_000 })).ok).toBe(true); // API calls still get through
  });

  it("rejects non-image and SVG content types, and oversized files", async () => {
    const html = await run((async () => new Response("<html>", { headers: { "content-type": "text/html" } })) as unknown as typeof fetch);
    expect(html).toEqual({ ok: false, kind: "upstream" });
    const svg = await run((async () => new Response("<svg/>", { headers: { "content-type": "image/svg+xml" } })) as unknown as typeof fetch);
    expect(svg).toEqual({ ok: false, kind: "upstream" });
    const big = await run((async () => img({ headers: { "content-length": String(9 * 1024 * 1024) } })) as unknown as typeof fetch);
    expect(big).toEqual({ ok: false, kind: "upstream" });
  });

  it("maps 404 and upstream failures", async () => {
    expect(await run((async () => new Response("", { status: 404 })) as unknown as typeof fetch)).toEqual({ ok: false, kind: "not_found" });
    expect(await run((async () => new Response("", { status: 500 })) as unknown as typeof fetch)).toEqual({ ok: false, kind: "upstream" });
    expect(await run((async () => { throw new Error("boom"); }) as unknown as typeof fetch)).toEqual({ ok: false, kind: "upstream" });
  });

  it("reports unconfigured when there are no credentials", async () => {
    vi.resetModules();
    setEnv({ DISCOGS_CONSUMER_KEY: "", DISCOGS_CONSUMER_SECRET: "" });
    const f = vi.fn();
    expect(await run(f as unknown as typeof fetch)).toEqual({ ok: false, kind: "unconfigured" });
    expect(f).not.toHaveBeenCalled();
  });
});
