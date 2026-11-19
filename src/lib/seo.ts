import type { Metadata } from "next";
import { site } from "@/config/site";
import { routing, type Locale } from "@/i18n/routing";

/** The pages anyone may read and a search engine may index. Everything else is the app. */
export const PUBLIC_PAGES = ["", "/contact", "/privacy", "/terms"] as const;

/** Paths robots.txt asks crawlers to stay out of: the API, and every locale's app screens (the screens that show Discogs data need a sign-in). */
export const APP_ONLY_PATHS = [
  "/api/",
  ...routing.locales.flatMap((l) => ["/search", "/master/", "/release/", "/lists", "/account", "/sign-in", "/sign-up", "/forgot-password", "/reset-password", "/verify-email"].map((p) => `/${l}${p}`)),
] as const;

/** Every public page in every language: `https://origin/en`, `https://origin/uk/contact`, ... */
export const publicUrls = (origin: string) => routing.locales.flatMap((l) => PUBLIC_PAGES.map((p) => `${origin}/${l}${p}`));

export const OG_LOCALE = { uk: "uk_UA", en: "en_US", nb: "nb_NO" } as const satisfies Record<Locale, string>;

/**
 * Meta tags for a PUBLIC page only: indexable, canonical, its translations, and Open Graph (title, description, site name, locale, address;
 * no image). Every other page is `noindex` by default (the locale layout), because it is the app and shows Discogs data behind a sign-in.
 */
export function publicMetadata(locale: Locale, page: (typeof PUBLIC_PAGES)[number], m: { title?: string; description: string }): Metadata {
  const url = `${site.url}/${locale}${page}`;
  return {
    ...(m.title ? { title: m.title } : {}),
    description: m.description,
    robots: { index: true, follow: true },
    alternates: { canonical: url, languages: Object.fromEntries(routing.locales.map((l) => [l, `${site.url}/${l}${page}`])) },
    openGraph: { type: "website", siteName: site.name, title: m.title ?? site.name, description: m.description, url, locale: OG_LOCALE[locale] },
  };
}
