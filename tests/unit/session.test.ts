import { describe, expect, it } from "vitest";
import { safeNextPath } from "@/server/auth/session";

describe("safeNextPath (open-redirect guard)", () => {
  it("accepts same-site relative paths", () => {
    expect(safeNextPath("/account")).toBe("/account");
    expect(safeNextPath("/search?q=abbey+road")).toBe("/search?q=abbey+road");
  });

  it.each([
    ["absolute URL", "https://evil.example/phish"],
    ["protocol-relative URL", "//evil.example"],
    ["backslash trick", "/\\evil.example"],
    ["no leading slash", "account"],
    ["javascript scheme", "javascript:alert(1)"],
    ["empty", ""],
  ])("rejects %s", (_name, value) => {
    expect(safeNextPath(value)).toBeNull();
  });

  it("handles missing and array values", () => {
    expect(safeNextPath(undefined)).toBeNull();
    expect(safeNextPath(["/a", "/b"])).toBe("/a");
  });
});
