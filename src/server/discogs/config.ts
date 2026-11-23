import "server-only";
import { site } from "@/config/site";
import { serverEnv } from "@/lib/env";

export const DEFAULT_API_BASE = "https://api.discogs.com";
export const DEFAULT_CACHE_TTL_SECONDS = 14_400; // 4 hours: leaves a 2 h margin under the 6 h display limit
/**
 * API Terms of Use: Content may not be displayed if it is more than six hours older than discogs.com, and may not be
 * cached or stored longer than necessary. So the configured TTL can never exceed this, whatever the env says.
 */
export const MAX_CONTENT_AGE_SECONDS = 21_600;

/** Hosts we will fetch images from. EXACT matches only (no wildcard subdomains). */
export const DISCOGS_IMAGE_HOSTS: readonly string[] = ["i.discogs.com", "img.discogs.com", "s.discogs.com"];

export const MAX_SEARCH_PAGES = 5;
export const MAX_VERSION_PAGES = 10;
export const PAGE_SIZE = 50;

export function apiBase(): string {
  return (serverEnv().DISCOGS_API_BASE ?? DEFAULT_API_BASE).replace(/\/+$/, "");
}

/** Identifier of the shared token bucket: one budget per API origin (so a test mock never shares the real one). */
export function bucketId(): string {
  return `api:${new URL(apiBase()).host}`;
}

/**
 * Images get their OWN budget, so a page of thumbnails can never use up the Discogs API allowance. The image host sends
 * no X-Discogs-Ratelimit headers (observed), so this is our own ceiling, shared by all users: 300 per minute on top of the
 * per-IP and per-user limits. A 429 from the image host blocks this bucket only.
 */
export const IMAGE_BUCKET_CAPACITY = 300;
export function imageBucketId(): string {
  return `img:${new URL(apiBase()).host}`;
}

/** THE one TTL constant: cache rows and the image proxy's Cache-Control all use it. Capped at 6 h (see above). */
export function cacheTtlSeconds(): number {
  return Math.min(serverEnv().DISCOGS_CACHE_TTL_SECONDS ?? DEFAULT_CACHE_TTL_SECONDS, MAX_CONTENT_AGE_SECONDS);
}

/** The default of APP_CONTACT (src/lib/env.ts): a placeholder that identifies nobody. */
const PLACEHOLDER_CONTACT = "https://example.com/contact";

/** `AppName/0.1 (+https://contact)` : descriptive, identifies the app and a way to reach its operator. Discogs asks for a unique,
 *  descriptive User-Agent so it can get in touch before it blocks an application that misbehaves. When APP_CONTACT is not set (or still
 *  the placeholder) the contact page of this site is used, so the header never names example.com. */
export function userAgent(): string {
  const configured = serverEnv().APP_CONTACT.trim();
  const contact = configured === "" || configured === PLACEHOLDER_CONTACT ? `${site.url.replace(/\/+$/, "")}/en/contact` : configured;
  const how = /^https?:\/\//i.test(contact) ? `+${contact}` : `contact: ${contact}`;
  return `${site.name}/0.1 (${how})`;
}

/**
 * Origins an image may be fetched from. The configured API origin is added ONLY when DISCOGS_API_BASE is
 * overridden (the e2e mock server); operators never set it in real environments, and users cannot influence it.
 */
export function allowedImageOrigins(): { hosts: readonly string[]; extraOrigin: string | null } {
  const override = serverEnv().DISCOGS_API_BASE;
  return { hosts: DISCOGS_IMAGE_HOSTS, extraOrigin: override ? new URL(override).origin : null };
}
