import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { discogsBucket } from "@/server/db/schema";
import type { AppDb } from "@/server/db/types";
import { createTestDb } from "../helpers/pglite";
import { setEnv } from "../helpers/env";

/**
 * More SSRF and redirect coverage for the image proxy (the basics are in discogs-image.test.ts): hostname tricks, numeric and
 * IPv6 address forms, redirect chains and loops, relative and downgrading redirects, and oversized bodies with no Content-Length.
 * The proxy fetches only the PARSED, allow-listed URL, with redirects handled by hand, one validated hop at a time.
 */

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
const png = () => new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), { status: 200, headers: { "content-type": "image/png" } });
const redirect = (to: string | null, status = 302) => new Response("", { status, headers: to === null ? {} : { location: to } });
const run = async (fetchImpl: typeof fetch, url = "https://i.discogs.com/a/cover.jpg") => {
  const { proxyImage } = await import("@/server/discogs/image");
  return proxyImage(url, { db, fetchImpl, now: () => 9_000_000 });
};
const urlsOf = (f: ReturnType<typeof vi.fn>) => f.mock.calls.map((c) => String(c[0]));

describe("validateImageUrl: more ways to smuggle a host", () => {
  it("rejects look-alike, encoded and odd-looking hosts", async () => {
    const { validateImageUrl } = await import("@/server/discogs/image");
    const bad = [
      "https://і.discogs.com/a.jpg", // Cyrillic "і": looks identical, is a different host
      "https://i.discogs.com%2f@evil.example/a.jpg",
      "https://i.discogs.com%00.evil.example/a.jpg",
      "https://i.discogs.com.evil.example/a.jpg",
      "https://evil.example#@i.discogs.com/a.jpg",
      "https://evil.example?@i.discogs.com/a.jpg",
      "https://i.discogs.com:80/a.jpg",
      "https://i-discogs.com/a.jpg",
      "https://idiscogs.com/a.jpg",
      "https://xn--i-discogs-9t5d.com/a.jpg",
    ];
    for (const url of bad) expect(validateImageUrl(url, ALLOW), url).toBeNull();
  });

  it("rejects every numeric and IPv6 spelling of an internal address", async () => {
    const { validateImageUrl } = await import("@/server/discogs/image");
    const bad = [
      "https://0/a.jpg",
      "https://0.0.0.0/a.jpg",
      "https://127.1/a.jpg",
      "https://017700000001/a.jpg", // octal
      "https://0x7f.0.0.1/a.jpg",
      "https://[::ffff:127.0.0.1]/a.jpg",
      "https://[::ffff:7f00:1]/a.jpg",
      "https://[::]/a.jpg",
      "https://[fd00::1]/a.jpg",
      "https://[fe80::1%25eth0]/a.jpg",
      "https://10.0.0.1/a.jpg",
      "https://192.168.1.1/a.jpg",
      "https://172.16.0.1/a.jpg",
      "https://100.64.0.1/a.jpg",
      "https://metadata.google.internal/a.jpg",
    ];
    for (const url of bad) expect(validateImageUrl(url, ALLOW), url).toBeNull();
  });

  it("a backslash before an @ makes the PARSED host the real one: what we fetch is the parsed URL, never evil.example", async () => {
    const { validateImageUrl } = await import("@/server/discogs/image");
    const u = validateImageUrl("https://i.discogs.com\\@evil.example/a.jpg", ALLOW);
    expect(u?.hostname).toBe("i.discogs.com");
    expect(u?.toString()).toBe("https://i.discogs.com/@evil.example/a.jpg");
  });

  it("accepts the exact hosts regardless of case, and a scheme-relative form never gets through", async () => {
    const { validateImageUrl } = await import("@/server/discogs/image");
    expect(validateImageUrl("HTTPS://I.DISCOGS.COM/a.jpg", ALLOW)?.hostname).toBe("i.discogs.com");
    expect(validateImageUrl("//i.discogs.com/a.jpg", ALLOW)).toBeNull();
  });
});

describe("proxyImage: redirects, one validated hop at a time", () => {
  it("follows a RELATIVE redirect on the same allowed host", async () => {
    const f = vi.fn().mockResolvedValueOnce(redirect("/other/real.png")).mockResolvedValueOnce(png());
    expect((await run(f as unknown as typeof fetch)).ok).toBe(true);
    expect(urlsOf(f)).toEqual(["https://i.discogs.com/a/cover.jpg", "https://i.discogs.com/other/real.png"]);
  });

  it("refuses a redirect that downgrades to http, even on an allowed host", async () => {
    const f = vi.fn().mockResolvedValueOnce(redirect("http://i.discogs.com/a.jpg"));
    expect(await run(f as unknown as typeof fetch)).toEqual({ ok: false, kind: "bad_request" });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("refuses a redirect with no Location, and every redirect status is treated the same", async () => {
    for (const status of [301, 302, 303, 307, 308]) {
      const f = vi.fn().mockResolvedValueOnce(redirect(null, status));
      expect(await run(f as unknown as typeof fetch), String(status)).toEqual({ ok: false, kind: "bad_request" });
    }
  });

  it("refuses redirects to numeric, IPv6, credentialed and look-alike targets without ever requesting them", async () => {
    const targets = ["https://127.0.0.1/a.jpg", "https://[::1]/a.jpg", "https://user:pw@i.discogs.com/a.jpg", "https://i.discogs.com.evil.example/a.jpg", "file:///etc/passwd", "javascript:alert(1)"];
    for (const to of targets) {
      const f = vi.fn().mockResolvedValueOnce(redirect(to));
      expect(await run(f as unknown as typeof fetch), to).toEqual({ ok: false, kind: "bad_request" });
      expect(f, to).toHaveBeenCalledTimes(1);
    }
  });

  it("gives up on a chain of redirects (even between allowed hosts) after a small, fixed number of hops", async () => {
    const f = vi.fn(async () => redirect("https://img.discogs.com/next.jpg"));
    expect(await run(f as unknown as typeof fetch)).toEqual({ ok: false, kind: "upstream" });
    expect(f.mock.calls.length).toBeLessThanOrEqual(3); // the first request plus at most 2 redirects
  });

  it("a redirect loop to itself is bounded too", async () => {
    const f = vi.fn(async () => redirect("https://i.discogs.com/a/cover.jpg"));
    expect(await run(f as unknown as typeof fetch)).toEqual({ ok: false, kind: "upstream" });
    expect(f.mock.calls.length).toBeLessThanOrEqual(3);
  });

  it("sends our Discogs credentials only to allow-listed hosts, on every hop", async () => {
    const f = vi.fn().mockResolvedValueOnce(redirect("https://img.discogs.com/x.png")).mockResolvedValueOnce(png());
    await run(f as unknown as typeof fetch);
    for (const call of f.mock.calls) {
      expect(["i.discogs.com", "img.discogs.com", "s.discogs.com"]).toContain(new URL(String(call[0])).hostname);
      expect((call[1] as RequestInit).redirect).toBe("manual");
    }
  });
});

describe("proxyImage: what is sent back", () => {
  it("accepts a content type with parameters, in any case, and still refuses script-capable types", async () => {
    const ok = await run((async () => new Response(new Uint8Array([1, 2]), { headers: { "content-type": "IMAGE/PNG; charset=binary" } })) as unknown as typeof fetch);
    expect(ok.ok).toBe(true);
    for (const type of ["image/svg+xml", "text/html", "application/javascript", "image/x-icon-ish", "application/octet-stream", ""]) {
      const r = await run((async () => new Response(new Uint8Array([1]), { headers: type ? { "content-type": type } : {} })) as unknown as typeof fetch);
      expect(r, type).toEqual({ ok: false, kind: "upstream" });
    }
  });

  it("an image with no Content-Length that turns out to be too large is cut off while streaming", async () => {
    const chunk = new Uint8Array(1024 * 1024);
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent++ >= 12) return controller.close(); // 12 MB against an 8 MB limit
        controller.enqueue(chunk);
      },
    });
    const out = await run((async () => new Response(stream, { headers: { "content-type": "image/jpeg" } })) as unknown as typeof fetch);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    await expect(out.response.arrayBuffer()).rejects.toThrow();
  });

  it("marks every proxied image as non-sniffable and sandboxed", async () => {
    const out = await run((async () => png()) as unknown as typeof fetch);
    if (!out.ok) throw new Error("expected ok");
    expect(out.response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(out.response.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
    expect(out.response.headers.get("set-cookie")).toBeNull();
  });
});
