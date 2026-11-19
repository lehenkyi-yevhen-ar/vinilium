import { themeInitScript } from "@/lib/theme";

/**
 * GET /theme-init.js: the one tiny script that applies the person's colour theme before the first paint (see src/lib/theme.ts).
 * It is a FILE, not an inline script, so the Content-Security-Policy can allow it with 'self' and needs no hash or nonce for it, and
 * so the 404 page (which is not rendered per request) can use it too. Built once at build time and served as a static asset.
 */
export const dynamic = "force-static";

export function GET() {
  return new Response(themeInitScript, {
    headers: {
      "Content-Type": "text/javascript; charset=utf-8",
      "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
    },
  });
}
