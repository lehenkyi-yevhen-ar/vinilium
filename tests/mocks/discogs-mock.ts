/**
 * A tiny fake of the Discogs API for e2e tests: no real token, no network.
 *   npx tsx tests/mocks/discogs-mock.ts            (port from MOCK_PORT, default 3201)
 *
 * It enforces what the real API enforces and the app must get right: the Authorization format, a User-Agent,
 * authenticated image requests, and X-Discogs-Ratelimit headers. Control endpoints (never used by the app):
 *   POST /__control {"throttleNext": n, "retryAfter": s}   next n API calls answer 429
 *   POST /__reset                                           clear counters and the request log
 *   GET  /__log                                             every request the app made, incl. auth headers
 *   POST /__control {"emailFail": 429}                       Brevo mock: answer this status to the next sends (null/0 = healthy again)
 *   GET  /__emails                                          emails the app sent through the Brevo mock (POST /brevo/v3/smtp/email)
 */
import http from "node:http";
import { masterPayloads, releasePayload, searchPage1, searchPage2, versionsPage } from "../fixtures/discogs";

const PORT = Number(process.env.MOCK_PORT ?? 3201);
const ORIGIN = `http://localhost:${PORT}`;
const EXPECTED_AUTH = "Discogs key=test-key, secret=test-secret";
const LIMIT = 60;

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

interface LogEntry {
  method: string;
  path: string;
  query: Record<string, string>;
  authorization: string | null;
  userAgent: string | null;
  status: number;
}

let log: LogEntry[] = [];
let used = 0;
let throttleNext = 0;
let retryAfter = 2;

// ---- Brevo mock (transactional email API) ----
const BREVO_KEY = "test-brevo-key";
let emails: Array<Record<string, unknown>> = [];
let emailFail = 0;

// Real Discogs hosts images on i.discogs.com; here they live on the mock so the proxy can fetch them.
const localise = (body: unknown) => JSON.parse(JSON.stringify(body).replaceAll("https://i.discogs.com/", `${ORIGIN}/images/`));

function send(res: http.ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  const data = typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(data);
}

type V = { id: number; label?: string; country?: string; released?: string; major_formats?: string[]; [k: string]: unknown };

/** Versions of a master after applying the same filters the real API supports, with facets for what is left. */
function versionsFor(query: Record<string, string>) {
  const seen = new Set<number>();
  const all = (versionsPage.versions as V[]).filter((v) => !seen.has(v.id) && seen.add(v.id));
  const kept = all.filter(
    (v) =>
      (!query.format || (v.major_formats ?? []).some((m) => m.toLowerCase() === query.format.toLowerCase())) &&
      (!query.country || v.country === query.country) &&
      (!query.label || v.label === query.label) &&
      (!query.released || v.released === query.released),
  );
  const facet = (id: string, pick: (v: V) => string | undefined) => {
    const counts = new Map<string, number>();
    for (const v of kept) {
      const value = pick(v);
      if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    return { id, title: id, values: [...counts].map(([value, count]) => ({ title: value, value, count })) };
  };
  return {
    pagination: { page: 1, pages: 1, per_page: 50, items: kept.length },
    versions: kept,
    filter_facets: [facet("country", (v) => v.country), facet("released", (v) => v.released), facet("label", (v) => v.label)],
  };
}

const rateHeaders = () => ({
  "x-discogs-ratelimit": String(LIMIT),
  "x-discogs-ratelimit-used": String(used),
  "x-discogs-ratelimit-remaining": String(Math.max(0, LIMIT - used)),
});

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", ORIGIN);
  const path = url.pathname;
  const query = Object.fromEntries(url.searchParams);

  // ---- control plane ----
  if (path === "/__health") return send(res, 200, { ok: true });
  if (path === "/__log") return send(res, 200, log);
  if (path === "/__reset") {
    log = [];
    used = 0;
    throttleNext = 0;
    emails = [];
    emailFail = 0;
    return send(res, 200, { ok: true });
  }
  if (path === "/__control") {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const b = JSON.parse(raw || "{}");
      if (typeof b.throttleNext === "number") throttleNext = b.throttleNext;
      if (typeof b.retryAfter === "number") retryAfter = b.retryAfter;
      if ("emailFail" in b) emailFail = Number(b.emailFail) || 0;
      send(res, 200, { throttleNext, retryAfter });
    });
    return;
  }

  const authorization = (req.headers.authorization as string | undefined) ?? null;
  const userAgent = (req.headers["user-agent"] as string | undefined) ?? null;
  const record = (status: number) => log.push({ method: req.method ?? "GET", path, query, authorization, userAgent, status });

  if (path === "/__emails") return send(res, 200, emails);
  if (path === "/brevo/v3/smtp/email" && req.method === "POST") {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      if (req.headers["api-key"] !== BREVO_KEY) return send(res, 401, { code: "unauthorized", message: "Key not found" });
      if (emailFail) return send(res, emailFail, { code: emailFail === 429 ? "too_many_requests" : "error", message: "mock failure" });
      const b = JSON.parse(raw || "{}");
      emails.push({ to: b.to?.[0]?.email, sender: b.sender, replyTo: b.replyTo, subject: b.subject, html: b.htmlContent, text: b.textContent });
      send(res, 201, { messageId: `<mock-${emails.length}@brevo.test>` });
    });
    return;
  }

  // ---- images: authenticated, like the real thing ----
  if (path.startsWith("/images/")) {
    if (authorization !== EXPECTED_AUTH) {
      record(401);
      return send(res, 401, { message: "You must authenticate to access this resource." });
    }
    if (path.includes("ratelimited")) {
      record(429);
      return send(res, 429, { message: "Too many requests" }, { "retry-after": "2" });
    }
    if (path.includes("notimage")) {
      record(200);
      return send(res, 200, "<html>nope</html>", { "content-type": "text/html" });
    }
    if (path.includes("missing")) {
      record(404);
      return send(res, 404, { message: "Not found" });
    }
    record(200);
    return send(res, 200, PNG, { "content-type": "image/png", "content-length": String(PNG.length) });
  }

  // ---- API ----
  if (!userAgent) {
    record(400);
    return send(res, 400, { message: "User-Agent required" });
  }
  if (authorization !== EXPECTED_AUTH) {
    record(401);
    return send(res, 401, { message: "You must authenticate to access this resource." });
  }
  if (throttleNext > 0) {
    throttleNext--;
    record(429);
    return send(res, 429, { message: "You are making requests too quickly." }, { "retry-after": String(retryAfter), ...rateHeaders() });
  }
  used++;

  let status = 200;
  let body: unknown;
  let m: RegExpMatchArray | null;
  if (path === "/database/search") {
    // A track that starts with "nomatch" / "cdonly" finds nothing on VINYL (exercises the empty state and its fallback).
    const track = (query.track ?? "").toLowerCase();
    if (query.format === "Vinyl" && (track.startsWith("nomatch") || track.startsWith("cdonly"))) {
      record(200);
      return send(res, 200, { pagination: { page: 1, pages: 1, per_page: 50, items: 0 }, results: [] }, rateHeaders());
    }
    const page = query.page === "2" ? searchPage2 : query.page && query.page !== "1" ? { pagination: { page: Number(query.page), pages: 3, per_page: 50, items: 120 }, results: [] } : searchPage1;
    // Honour format=Vinyl like the real API: without it the CD hit comes through too.
    const by = (query.track || query.release_title) && query.artist ? query.artist.toLowerCase() : "";
    const results = (page.results as Array<{ format?: string[]; title?: string } | null>)
      .filter((r) => !query.format || !r?.format || r.format.includes(query.format))
      // "track/album + artist": only that artist's hits (the real API narrows the same way)
      .filter((r) => !by || (r?.title ?? "").toLowerCase().startsWith(by));
    body = localise({ ...page, results });
  } else if ((m = path.match(/^\/masters\/(\d+)\/versions$/))) {
    body = localise(versionsFor(query));
  } else if ((m = path.match(/^\/masters\/(\d+)$/))) {
    const master = masterPayloads[Number(m[1])];
    if (!master) {
      status = 404;
      body = { message: "Master release not found." };
    } else body = localise(master);
  } else if ((m = path.match(/^\/releases\/(\d+)$/))) {
    if (m[1] === "404404") {
      status = 404;
      body = { message: "Release not found." };
    } else if (Number(m[1]) >= 100_000_000) {
      // The list screens' records: every id is its own record, so a test can tell the cards apart.
      const id = Number(m[1]);
      body = localise({ ...releasePayload, id, master_id: 0, title: `Library Record ${id}`, uri: `https://www.discogs.com/release/${id}-Library-Record` });
    } else if (Number(m[1]) >= 7000 && Number(m[1]) < 7100) {
      // The standalone releases some finder specs inject into the albums list ("Odd Pressing <n>", kind release, no master): the release record must
      // agree with that, or its Back link legitimately points at a master page (it used to say master_id 500, which made finder-nav-390 depend on timing).
      const n = Number(m[1]) - 7000;
      body = localise({ ...releasePayload, id: Number(m[1]), master_id: 0, title: `Odd Pressing ${n}`, year: 2020 + n, released: String(2020 + n), uri: `https://www.discogs.com/release/${m[1]}-Odd-Pressing` });
    } else {
      body = localise({ ...releasePayload, id: Number(m[1]) });
    }
  } else {
    status = 404;
    body = { message: "The requested resource was not found." };
  }
  record(status);
  send(res, status, body, rateHeaders());
});

server.listen(PORT, () => console.log(`[discogs-mock] listening on ${ORIGIN}`));
