import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";

// Next.js 16 renamed `middleware` to `proxy`. This only handles locale negotiation/redirects.
export default createMiddleware(routing);

export const config = {
  // Skip API routes, Next internals and static files (anything with a dot, e.g. /ds/tokens.css).
  matcher: ["/((?!api|_next|_vercel|ds|.*\..*).*)"],
};
