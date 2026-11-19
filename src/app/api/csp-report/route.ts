import { MAX_REPORT_BYTES, parseCspReports } from "@/lib/security-headers";
import { getDb } from "@/server/db";
import { clientIp, hit } from "@/server/rate-limit";

/**
 * POST /api/csp-report: receives Content-Security-Policy-Report-Only violation reports from browsers and writes a short line to
 * the server log (Vercel > Logs, search "[csp-report]"). Nothing is stored. Anonymous by nature (browsers send it), so it is small,
 * rate limited per IP, and answers 204 to everything: it never reveals anything and never errors a page.
 */
export async function POST(request: Request) {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_REPORT_BYTES) return new Response(null, { status: 204 });

  try {
    const limit = await hit(getDb(), { key: `csp:ip:${clientIp(request.headers)}`, limit: 30, windowSec: 60 });
    if (!limit.allowed) return new Response(null, { status: 204 });

    const text = (await request.text()).slice(0, MAX_REPORT_BYTES);
    for (const v of parseCspReports(JSON.parse(text))) {
      console.warn(`[csp-report] ${v.directive} blocked=${v.blocked || "-"} page=${v.document || "-"} source=${v.source || "-"}`);
    }
  } catch {
    // malformed JSON or a database hiccup (LimiterUnavailableError included): a report is best-effort and this endpoint protects nothing but log
    // volume, so it fails OPEN (the report is dropped, the page is never affected)
  }
  return new Response(null, { status: 204 });
}
