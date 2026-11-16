import { describe, expect, it } from "vitest";
import { parseContact, parseContactEmail, parseTelegram } from "@/lib/contact";

describe("parseContactEmail", () => {
  it("accepts ordinary addresses and trims them", () => {
    expect(parseContactEmail("  hello@example.com ")).toBe("hello@example.com");
    expect(parseContactEmail("first.last+tag@sub.example.org")).toBe("first.last+tag@sub.example.org");
  });

  it("drops anything that is not a plain address", () => {
    for (const bad of ["", "   ", "nope", "a@b", "a@@b.co", "a b@c.co", "<a@b.co>", "a@b.co, c@d.co", "javascript:alert(1)", "a@b.co?subject=x"]) {
      expect(parseContactEmail(bad), bad).toBeNull();
    }
    expect(parseContactEmail(undefined)).toBeNull();
    expect(parseContactEmail(null)).toBeNull();
    expect(parseContactEmail(`${"a".repeat(250)}@b.co`)).toBeNull();
  });
});

describe("parseTelegram", () => {
  it("normalises handles and t.me links to https://t.me/<handle>", () => {
    const want = { url: "https://t.me/vinilium_app", label: "@vinilium_app" };
    for (const v of ["@vinilium_app", "vinilium_app", "t.me/vinilium_app", "https://t.me/vinilium_app", "http://telegram.me/vinilium_app", "  https://t.me/vinilium_app/ "]) {
      expect(parseTelegram(v), v).toEqual(want);
    }
  });

  it("keeps invite links, labelled generically", () => {
    expect(parseTelegram("https://t.me/+AbCdEf123456")).toEqual({ url: "https://t.me/+AbCdEf123456", label: "Telegram" });
  });

  it("is empty when unset, so the page hides the line", () => {
    expect(parseTelegram(undefined)).toBeNull();
    expect(parseTelegram("")).toBeNull();
    expect(parseTelegram("   ")).toBeNull();
  });

  it("never produces an unsafe or foreign link", () => {
    for (const bad of [
      "javascript:alert(1)",
      "data:text/html,x",
      "https://evil.example/vinilium_app",
      "https://t.me.evil.example/vinilium_app",
      "https://t.me@evil.example/vinilium_app",
      "https://user:pw@t.me/vinilium_app",
      "https://t.me:8080/vinilium_app",
      "https://t.me/vinilium_app/extra",
      "https://t.me/ab", // too short to be a username
      "@a b",
      "https://t.me/",
      "ftp://t.me/vinilium_app",
    ]) {
      expect(parseTelegram(bad), bad).toBeNull();
    }
  });
});

describe("parseContact", () => {
  it("combines both, each independently optional", () => {
    expect(parseContact({ email: "a@b.co", telegram: "@my_handle" })).toEqual({
      email: "a@b.co",
      telegram: { url: "https://t.me/my_handle", label: "@my_handle" },
    });
    expect(parseContact({ email: "a@b.co", telegram: "" })).toEqual({ email: "a@b.co", telegram: null });
    expect(parseContact({})).toEqual({ email: null, telegram: null });
  });
});
