import "server-only";
import { site } from "@/config/site";
import { serverEnv } from "@/lib/env";

export const DEFAULT_API_BASE = "https://api.discogs.com";
export const DEFAULT_CACHE_TTL_SECONDS = 21_600; // 6 hours

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

/** THE one TTL constant: cached API data, cache rows, and the image proxy's Cache-Control all use it. */
export function cacheTtlSeconds(): number {
  return serverEnv().DISCOGS_CACHE_TTL_SECONDS ?? DEFAULT_CACHE_TTL_SECONDS;
}

/** `AppName/0.1 (+https://contact)` : descriptive, identifies the app and a way to reach its operator. */
export function userAgent(): string {
  const contact = serverEnv().APP_CONTACT.trim();
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
