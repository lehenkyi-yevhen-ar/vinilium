import { describe, expect, it } from "vitest";
import { accountExportJson, buildAccountExport } from "@/lib/account/export";
import { EXPORT_COLUMNS } from "@/lib/lists/export";
import type { StoredItemJson } from "@/lib/lists/rules";

const profile = { name: "Test Person", email: "person@example.test", emailVerified: true, locale: "nb", createdAt: new Date("2026-03-04T05:06:07Z") };
const item: StoredItemJson = {
  releaseId: 951004,
  list: "collection",
  notes: "bought in Oslo",
  conditionMedia: "NM",
  conditionSleeve: "VG+",
  addedAt: "2026-01-02T00:00:00.000Z",
  updatedAt: "2026-01-03T00:00:00.000Z",
};

describe("account data export", () => {
  it("has the profile fields and the lists, and nothing else", () => {
    const out = buildAccountExport(profile, [item], new Date("2026-05-06T00:00:00Z"));
    expect(out).toEqual({
      exportedAt: "2026-05-06T00:00:00.000Z",
      account: { name: "Test Person", email: "person@example.test", emailVerified: true, language: "nb", createdAt: "2026-03-04T05:06:07.000Z" },
      lists: {
        columns: [...EXPORT_COLUMNS],
        items: [{ discogs_release_id: 951004, list: "collection", notes: "bought in Oslo", condition_media: "NM", condition_sleeve: "VG+", added_at: item.addedAt, updated_at: item.updatedAt }],
      },
    });
  });

  it("is a whitelist: a user row with secrets cannot leak through it", () => {
    const row = { ...profile, id: "u1", password: "scrypt$hash", ipAddress: "203.0.113.9", accessToken: "ya29.x", image: "https://example.test/p.png" };
    const text = accountExportJson(row, [item]);
    expect(text).not.toMatch(/scrypt|203\.0\.113|ya29|u1|p\.png|password|token|session/i);
    expect(JSON.parse(text).account).toHaveProperty("email");
  });

  it("defaults the language, handles an empty list, and ends with a newline", () => {
    const out = JSON.parse(accountExportJson({ ...profile, locale: null }, []));
    expect(out.account.language).toBe("en");
    expect(out.lists.items).toEqual([]);
    expect(accountExportJson(profile, []).endsWith("\n")).toBe(true);
  });
});
