/**
 * A tiny fake of the Discogs API for e2e tests: no real token, no network.
 *   npx tsx tests/mocks/discogs-mock.ts            (port from MOCK_PORT, default 3201)
 *
 * It enforces what the real API enforces and the app must get right: the Authorization format, a User-Agent,
 * authenticated image requests, and X-Discogs-Ratelimit headers. Control endpoints (never used by the app):
 *   POST /__control {"throttleNext": n, "retryAfter": s}   next n API calls answer 429
 *   POST /__reset                                           clear counters and the request log
 *   GET  /__log                                             every request the app made, incl. auth headers
 */
import http from "node:http";
import { releasePayload, searchPage1, searchPage2, versionsPage } from "../fixtures/discogs";

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

// Real Discogs hosts images on i.discogs.com; here they live on the mock so the proxy can fetch them.
const localise = (body: unknown) => JSON.parse(JSON.stringify(body).replaceAll("https://i.discogs.com/", `${ORIGIN}/images/`));

function send(res: http.ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  const data = typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(data);
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
    return send(res, 200, { ok: true });
  }
  if (path === "/__control") {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const b = JSON.parse(raw || "{}");
      if (typeof b.throttleNext === "number") throttleNext = b.throttleNext;
      if (typeof b.retryAfter === "number") retryAfter = b.retryAfter;
      send(res, 200, { throttleNext, retryAfter });
    });
    return;
  }

  const authorization = (req.headers.authorization as string | undefined) ?? null;
  const userAgent = (req.headers["user-agent"] as string | undefined) ?? null;
  const record = (status: number) => log.push({ method: req.method ?? "GET", path, query, authorization, userAgent, status });

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
    body = query.page === "2" ? searchPage2 : query.page && query.page !== "1" ? { pagination: { page: Number(query.page), pages: 3, per_page: 50, items: 120 }, results: [] } : searchPage1;
    body = localise(body);
  } else if ((m = path.match(/^\/masters\/(\d+)\/versions$/))) {
    body = localise(versionsPage);
  } else if ((m = path.match(/^\/releases\/(\d+)$/))) {
    if (m[1] === "404404") {
      status = 404;
      body = { message: "Release not found." };
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
