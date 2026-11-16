import "server-only";
import { allowedImageOrigins, bucketId, cacheTtlSeconds } from "./config";
import { discogsHeaders } from "./client";
import { resolveDiscogsAuth } from "./credentials";
import { acquireToken, blockFor, parseRateHeaders, recordObserved, type AppDb } from "./token-bucket";

/**
 * Image proxy: the browser never talks to Discogs image hosts. We validate the URL against an exact host
 * allow-list (SSRF), fetch it with our credentials, and STREAM the bytes back. Nothing is written to disk or
 * to the database; the only caching is `Cache-Control` bounded by the one TTL constant.
 */

export const PROXY_PATH = "/api/discogs/image";
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const ALLOWED_CONTENT_TYPES = /^image\/(jpeg|png|gif|webp)$/i; // no SVG: it can carry script
/** Images may use at most this share of the bucket, so thumbnails cannot starve API calls. */
export const IMAGE_RESERVE_FRACTION = 0.25;
const MAX_REDIRECTS = 2;

export interface ImageAllowList {
  hosts: readonly string[];
  /** Extra exact origin (scheme + host + port) trusted for tests only; see config.allowedImageOrigins. */
  extraOrigin?: string | null;
}

/**
 * Returns the normalised URL if (and only if) it may be fetched, else null.
 * Rules: https, exact allow-listed host, default port, no credentials, no IP literals, no dot tricks.
 */
export function validateImageUrl(raw: string, allow: ImageAllowList): URL | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 2048) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.username || u.password) return null;

  if (allow.extraOrigin && u.origin === allow.extraOrigin) return u; // test mock server only
  if (u.protocol !== "https:") return null;
  if (u.port !== "") return null;
  const host = u.hostname; // URL lowercases it; a trailing dot would remain and fail the exact match
  if (!allow.hosts.includes(host)) return null;
  return u;
}

/** Maps an upstream image URL to our proxy URL; null when it is not an allowed image URL. */
export function toProxyUrl(upstream: string | null | undefined, allow: ImageAllowList): string | null {
  if (!upstream) return null;
  if (/spacer\.gif($|\?)/i.test(upstream)) return null; // Discogs' "no image" placeholder
  const ok = validateImageUrl(upstream, allow);
  return ok ? `${PROXY_PATH}?u=${encodeURIComponent(ok.toString())}` : null;
}

export function imageMapper() {
  const allow = allowedImageOrigins();
  return (u: string | null | undefined) => toProxyUrl(u, allow);
}

export type ImageOutcome =
  | { ok: true; response: Response }
  | { ok: false; kind: "bad_request" | "not_found" | "unconfigured" | "upstream" }
  | { ok: false; kind: "throttled"; retryAfter: number };

/** Caps the streamed size without buffering the image. */
function limitBytes(max: number): TransformStream<Uint8Array, Uint8Array> {
  let seen = 0;
  return new TransformStream({
    transform(chunk, controller) {
      seen += chunk.byteLength;
      if (seen > max) controller.error(new Error("image too large"));
      else controller.enqueue(chunk);
    },
  });
}

export async function proxyImage(
  rawUrl: string,
  deps: { db: AppDb; fetchImpl?: typeof fetch; now?: () => number },
): Promise<ImageOutcome> {
  const allow = allowedImageOrigins();
  const first = validateImageUrl(rawUrl, allow);
  if (!first) return { ok: false, kind: "bad_request" };

  const auth = resolveDiscogsAuth();
  if (!auth) return { ok: false, kind: "unconfigured" };

  const f = deps.fetchImpl ?? fetch;
  const clock = deps.now ?? Date.now;
  const id = bucketId();

  // Images draw on the same budget as API calls, but never dip into the reserve.
  const taken = await acquireToken(deps.db, { id, reserveFraction: IMAGE_RESERVE_FRACTION, now: clock() });
  if (!taken.ok) return { ok: false, kind: "throttled", retryAfter: taken.retryAfterSec };

  let current: URL = first;
  let res: Response | null = null;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let r: Response;
    try {
      r = await f(current, {
        headers: discogsHeaders(auth.header), // only ever sent to an allow-listed host (validated above and per hop)
        redirect: "manual",
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      return { ok: false, kind: "upstream" };
    }
    if (r.status >= 300 && r.status < 400) {
      const location = r.headers.get("location");
      r.body?.cancel().catch(() => {});
      const target: URL | null = location ? validateImageUrl(new URL(location, current).toString(), allow) : null;
      if (!target) return { ok: false, kind: "bad_request" }; // redirect to a non-allowed place: refuse
      current = target;
      continue;
    }
    res = r;
    break;
  }
  if (!res) return { ok: false, kind: "upstream" };

  const rate = parseRateHeaders(res.headers);
  if (rate.limit !== null || rate.remaining !== null) await recordObserved(deps.db, { id, ...rate, now: clock() }).catch(() => {});

  if (res.status === 429) {
    res.body?.cancel().catch(() => {});
    const retryAfter = Math.max(1, Number.parseInt(res.headers.get("retry-after") ?? "", 10) || 5);
    await blockFor(deps.db, { id, seconds: retryAfter, now: clock() }).catch(() => {});
    return { ok: false, kind: "throttled", retryAfter };
  }
  if (res.status === 404) return { ok: false, kind: "not_found" };
  if (!res.ok || !res.body) return { ok: false, kind: "upstream" };

  const type = res.headers.get("content-type")?.split(";")[0].trim() ?? "";
  const length = Number(res.headers.get("content-length") ?? 0);
  if (!ALLOWED_CONTENT_TYPES.test(type) || length > MAX_IMAGE_BYTES) {
    res.body.cancel().catch(() => {});
    return { ok: false, kind: "upstream" };
  }

  const ttl = cacheTtlSeconds();
  const headers = new Headers({
    "Content-Type": type,
    "Cache-Control": `public, max-age=${ttl}, s-maxage=${ttl}`,
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
  });
  if (length > 0) headers.set("Content-Length", String(length));
  return { ok: true, response: new Response(res.body.pipeThrough(limitBytes(MAX_IMAGE_BYTES)), { status: 200, headers }) };
}
