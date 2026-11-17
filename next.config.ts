import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { securityHeaders } from "./src/lib/security-headers";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

// Note: the scaffold enabled `cacheComponents` / `partialPrefetching`. They are turned
// off on purpose: this app reads the session and locale on almost every route and does
// its real caching in Postgres (see docs), so Cache Components would only add Suspense
// boilerplate. Revisit if we want static shells later.
const nextConfig: NextConfig = {
  poweredByHeader: false,
  // The root layout sits under the [locale] segment, so a regular not-found.tsx cannot be composed;
  // Next.js documents global-not-found for exactly this case.
  experimental: { globalNotFound: true },
  async headers() {
    return [
      {
        // Every response (pages, API, static). HSTS appears only when HSTS_MAX_AGE_SECONDS is set (see security-headers.ts).
        source: "/:path*",
        headers: securityHeaders({
          dev: process.env.NODE_ENV !== "production",
          hstsMaxAgeSeconds: process.env.HSTS_MAX_AGE_SECONDS,
          hstsIncludeSubdomains: process.env.HSTS_INCLUDE_SUBDOMAINS === "1",
        }),
      },
      {
        // Vendored design-system files: cache for a day, revalidate in the background.
        source: "/ds/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=604800" }],
      },
    ];
  },
};

export default withNextIntl(nextConfig);
