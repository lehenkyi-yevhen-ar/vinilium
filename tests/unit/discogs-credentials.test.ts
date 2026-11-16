import { describe, expect, it } from "vitest";

import { resolveDiscogsAuth } from "@/server/discogs/credentials";

describe("resolveDiscogsAuth", () => {
  it("uses a personal token when only the token is set", () => {
    expect(resolveDiscogsAuth({ DISCOGS_TOKEN: "tok" })).toEqual({
      mode: "token",
      header: "Discogs token=tok",
    });
  });

  it("uses key + secret when both are set", () => {
    expect(resolveDiscogsAuth({ DISCOGS_CONSUMER_KEY: "k", DISCOGS_CONSUMER_SECRET: "s" })).toEqual({
      mode: "key-secret",
      header: "Discogs key=k, secret=s",
    });
  });

  it("prefers key + secret over the token when both are configured", () => {
    const auth = resolveDiscogsAuth({
      DISCOGS_TOKEN: "tok",
      DISCOGS_CONSUMER_KEY: "k",
      DISCOGS_CONSUMER_SECRET: "s",
    });
    expect(auth?.mode).toBe("key-secret");
    expect(auth?.header).not.toContain("tok");
  });

  it("trims whitespace and treats blanks as unset", () => {
    expect(resolveDiscogsAuth({ DISCOGS_TOKEN: "  tok \n" })?.header).toBe("Discogs token=tok");
    expect(resolveDiscogsAuth({ DISCOGS_TOKEN: "   ", DISCOGS_CONSUMER_KEY: "", DISCOGS_CONSUMER_SECRET: "" })).toBeNull();
  });

  it("ignores a half-set pair when a token exists", () => {
    expect(resolveDiscogsAuth({ DISCOGS_TOKEN: "tok", DISCOGS_CONSUMER_KEY: "k" })?.mode).toBe("token");
  });

  it("throws on a half-set pair with no token, without echoing the value", () => {
    expect(() => resolveDiscogsAuth({ DISCOGS_CONSUMER_KEY: "k-value" })).toThrow(/incomplete/);
    expect(() => resolveDiscogsAuth({ DISCOGS_CONSUMER_SECRET: "s-value" })).toThrow(/incomplete/);
    try {
      resolveDiscogsAuth({ DISCOGS_CONSUMER_KEY: "k-value" });
    } catch (e) {
      expect(String(e)).not.toContain("k-value");
    }
  });

  it("returns null when nothing is configured", () => {
    expect(resolveDiscogsAuth({})).toBeNull();
  });
});
