import { describe, expect, it } from "vitest";
import { applyLocalNeonProxy } from "@/lib/neon-local";
import { discogsUrlFor } from "@/lib/discogs/normalize";
import { parseTelegram } from "@/lib/contact";
import { isCrossSite, originMatches } from "@/server/auth/request-user";
import { safeNextPath } from "@/server/auth/session";
import { toProxyUrl, validateImageUrl } from "@/server/discogs/image";

/**
 * Every place the app decides something from a URL, host, origin or redirect target, with hostile input. The rule behind them all: PARSE with
 * the URL class and compare the exact host or origin (or an exact suffix on a dot boundary); never look for a substring.
 * (CodeQL "Incomplete URL substring sanitization" is about the opposite habit.)
 */

const ALLOW = { hosts: ["i.discogs.com", "img.discogs.com", "s.discogs.com"] as const, extraOrigin: null };

describe("image allow-list: exact host, https, no credentials, no port", () => {
  const bad = [
    "https://evil.com/i.discogs.com/a.jpg", // host in the path
    "https://evil.com/?u=https://i.discogs.com/a.jpg", // host in the query
    "https://evil.com#i.discogs.com",
    "https://i.discogs.com.evil.com/a.jpg", // suffix trick
    "https://evili.discogs.com/a.jpg", // not on the list
    "https://discogs.com/a.jpg",
    "https://www.discogs.com/a.jpg",
    "https://i.discogs.com@evil.com/a.jpg", // userinfo
    "https://user:pw@i.discogs.com/a.jpg", // credentials, even on the right host
    "https://i.discogs.com:443@evil.com/a.jpg",
    "https://i.discogs.com:8443/a.jpg", // a port
    "https://i.discogs.com%2eevil.com/a.jpg", // percent-encoded dot gluing on a suffix
    "https://evil.com\\@i.discogs.com/a.jpg",
    "http://i.discogs.com/a.jpg", // not https
    "//i.discogs.com/a.jpg", // no scheme
    "i.discogs.com/a.jpg",
    "javascript://i.discogs.com/%0aalert(1)",
    "data:text/html,i.discogs.com",
    "https://[::1]/i.discogs.com",
    "https://[2001:db8::1]/a.jpg",
    "https://xn--discogs-9ya.com/a.jpg", // punycode look-alike
    "https://xn--i-discogs.com/a.jpg",
    "",
    "   ",
  ];
  it.each(bad)("refuses %j", (url) => {
    expect(validateImageUrl(url, ALLOW)).toBeNull();
    expect(toProxyUrl(url, ALLOW)).toBeNull();
  });

  it("percent-encoded dots and backslashes are decoded by the parser, and what is checked AND fetched is the parsed URL", () => {
    // "%2e" is a dot to the URL parser: this IS the allowed host, so it is accepted, and the URL we would fetch has the plain host.
    expect(validateImageUrl("https://i%2ediscogs%2ecom/a.jpg", ALLOW)?.href).toBe("https://i.discogs.com/a.jpg");
    // a backslash ends the host: the host is i.discogs.com and ".evil.com/a.jpg" is only a PATH on it
    const u = validateImageUrl("https://i.discogs.com\\.evil.com/a.jpg", ALLOW);
    expect(u?.hostname).toBe("i.discogs.com");
    expect(u?.pathname).toBe("/.evil.com/a.jpg");
  });

  it("a trailing dot is a different spelling of the same host and is refused (the allow-list is exact)", () => {
    expect(validateImageUrl("https://i.discogs.com./a.jpg", ALLOW)).toBeNull();
  });

  it("mixed case and a default port are the same host and are accepted, as the parsed, lower-cased URL", () => {
    expect(validateImageUrl("HTTPS://I.DISCOGS.COM/a.jpg", ALLOW)?.hostname).toBe("i.discogs.com");
    expect(validateImageUrl("https://i.discogs.com:443/a.jpg", ALLOW)?.href).toBe("https://i.discogs.com/a.jpg");
  });

  it("accepts exactly the listed hosts", () => {
    for (const host of ALLOW.hosts) expect(validateImageUrl(`https://${host}/x/y.jpg?z=1`, ALLOW)?.hostname).toBe(host);
  });
});

describe("applyLocalNeonProxy: a real Neon host is never rerouted, however it is spelled", () => {
  const env = { NEON_WS_PROXY: "localhost:5433/v1" };
  const reroutes = (host: string) => applyLocalNeonProxy({}, env, `postgresql://u:p@${host}/db`);

  it.each(["ep-x-pooler.eu-central-1.aws.neon.tech", "EP-X.NEON.TECH", "x.neon.tech.", "x.neon.tech..", "neon.tech.", "x%2eneon%2etech", "x.neon%2Etech", "x.NEON.tech", "%zz"])(
    "never for %s",
    (host) => expect(reroutes(host)).toBe(false),
  );

  it.each(["postgres", "localhost", "db.internal", "neon.tech.evil.example", "xneon.tech", "x-neon.tech.example", "neon-tech"])("a non-Neon host (%s) is routed through the proxy", (host) => {
    expect(reroutes(host)).toBe(true);
  });
});

describe("discogsUrlFor: only https://(www.)discogs.com paths survive", () => {
  const FALLBACK = "https://www.discogs.com/release/5";
  it.each([
    "https://evil.com/release/9-x",
    "https://discogs.com.evil.com/release/9-x",
    "https://evil.com/discogs.com/release/9-x",
    "https://www.discogs.com@evil.com/release/9-x",
    "https://user@www.discogs.com.evil.com/release/9-x",
    "http://www.discogs.com/release/9-x", // not https
    "//evil.com/release/9-x",
    "javascript:alert(1)",
    "/\\evil.com",
    "/release/9 x", // a space: not in the allowed path characters
    "/release/9?next=https://evil.com",
  ])("falls back to the canonical link for %j", (uri) => {
    expect(discogsUrlFor("release", 5, uri)).toBe(FALLBACK);
  });

  it("whatever comes in, the link is on https://www.discogs.com, and a good path is kept", () => {
    expect(discogsUrlFor("release", 5, "https://www.discogs.com/release/9-Name")).toBe("https://www.discogs.com/release/9-Name");
    expect(discogsUrlFor("release", 5, "/release/9-Name")).toBe("https://www.discogs.com/release/9-Name");
    expect(discogsUrlFor("master", 7, "https://DISCOGS.com/master/7-X")).toBe("https://www.discogs.com/master/7-X");
    for (const uri of ["https://www.discogs.com/release/9?x=https://evil.com", "https://www.discogs.com//evil.com", "x", 5, null, undefined]) {
      expect(new URL(discogsUrlFor("release", 5, uri)).origin).toBe("https://www.discogs.com");
    }
  });
});

describe("parseTelegram: always a https://t.me address built by us", () => {
  it.each([
    "https://evil.com/t.me/handle",
    "https://t.me.evil.com/handle",
    "https://evil.com@t.me/handle",
    "https://t.me@evil.com/handle",
    "https://t.me:444/handle",
    "https://user:pw@t.me/handle",
    "javascript:alert(1)",
    "ftp://t.me/handle",
    "https://t%2eme.evil.com/handle",
    "https://t.me\\@evil.com/handle",
    "https://nott.me/handle",
  ])("refuses %j", (value) => {
    expect(parseTelegram(value)).toBeNull();
  });

  it("accepts the real thing and rebuilds the address itself", () => {
    expect(parseTelegram("https://T.ME/some_handle")?.url).toBe("https://t.me/some_handle");
    expect(parseTelegram("telegram.me/some_handle")?.url).toBe("https://t.me/some_handle");
    expect(parseTelegram("@some_handle")?.url).toBe("https://t.me/some_handle");
  });
});

describe("originMatches / isCrossSite", () => {
  const req = (headers: Record<string, string>) => new Request("https://app.example/api/x", { method: "PUT", headers });

  it.each([
    "https://evil.com",
    "https://app.example.evil.com",
    "https://evil.com/app.example",
    "https://app.example@evil.com",
    "https://evilapp.example",
    "http://app.example:8080", // another port is another origin
    "null",
    "app.example", // not an origin
    "https://app.example\\@evil.com",
    "https://app%2eexample",
  ])("a write with Origin %j is refused for host app.example", (origin) => {
    expect(originMatches(req({ origin, host: "app.example" }))).toBe(false);
  });

  it("accepts the site's own origin (any case) and requests with no Origin at all (non-browser clients)", () => {
    expect(originMatches(req({ origin: "https://APP.example", host: "app.example" }))).toBe(true);
    expect(originMatches(req({ host: "app.example" }))).toBe(true);
  });

  it("the forwarded host wins over Host, so an evil Origin cannot match by forging Host", () => {
    expect(originMatches(req({ origin: "https://evil.com", host: "evil.com", "x-forwarded-host": "app.example" }))).toBe(false);
  });

  it("isCrossSite is an exact comparison of Sec-Fetch-Site, not a substring", () => {
    expect(isCrossSite(req({ "sec-fetch-site": "cross-site" }))).toBe(true);
    for (const v of ["same-origin", "same-site", "none", "not-cross-site", "cross-site2", ""]) expect(isCrossSite(req({ "sec-fetch-site": v })), v).toBe(false);
  });
});

describe("safeNextPath: hostile redirect targets", () => {
  it.each(["https://evil.com", "//evil.com", "///evil.com", "/\\evil.com", "\\\\evil.com", "https:evil.com", "/\t/evil.com", "/\n/evil.com", "javascript:alert(1)", "data:text/html,x", "evil.com"])(
    "%j is refused",
    (value) => {
      expect(safeNextPath(value)).toBeNull();
    },
  );

  it("whatever is accepted stays on the site", () => {
    for (const v of ["/%5cevil.com/x", "/..;/evil.com", "/a/../../evil.com", "/search?next=https://evil.com"]) {
      const out = safeNextPath(v);
      if (out !== null) expect(new URL(out, "https://app.example").origin).toBe("https://app.example");
    }
  });
});
