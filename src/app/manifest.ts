import type { MetadataRoute } from "next";
import { site } from "@/config/site";

/**
 * The web app manifest: makes the site installable ("add to home screen") and nothing more. There is deliberately NO service worker and
 * no offline cache: the Discogs Terms forbid keeping Discogs content beyond the 6-hour display limit, and an offline shell would blur that.
 * Colours are the design system's own (public/ds/tokens.css, dark theme).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: site.name,
    short_name: site.name,
    description: "Find vinyl pressings, keep a wishlist and track your collection.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#121611",
    theme_color: "#121611",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
