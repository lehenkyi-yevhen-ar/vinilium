import type { MetadataRoute } from "next";
import { site } from "@/config/site";
import { APP_ONLY_PATHS } from "@/lib/seo";

/**
 * robots.txt: the public pages may be indexed; the app, its screens and the API may not. (Robots.txt is a request, not access control:
 * the screens that show Discogs data need a sign-in anyway.)
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: [...APP_ONLY_PATHS] }],
    sitemap: `${site.url}/sitemap.xml`,
  };
}
