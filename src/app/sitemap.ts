import type { MetadataRoute } from "next";
import { site } from "@/config/site";
import { routing } from "@/i18n/routing";
import { PUBLIC_PAGES } from "@/lib/seo";

/** sitemap.xml: the public pages only (home, contact, privacy, terms), each with its translations. Never the app or the API. */
export default function sitemap(): MetadataRoute.Sitemap {
  return routing.locales.flatMap((locale) =>
    PUBLIC_PAGES.map((page) => ({
      url: `${site.url}/${locale}${page}`,
      alternates: { languages: Object.fromEntries(routing.locales.map((l) => [l, `${site.url}/${l}${page}`])) },
    })),
  );
}
