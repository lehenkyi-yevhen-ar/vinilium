import { describe, expect, it } from "vitest";
import en from "@/messages/en.json";
import nb from "@/messages/nb.json";
import uk from "@/messages/uk.json";

type Json = { [k: string]: Json | string };

function flatten(obj: Json, prefix = ""): Record<string, string> {
  return Object.entries(obj).reduce<Record<string, string>>((acc, [k, v]) => {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") acc[key] = v;
    else Object.assign(acc, flatten(v, key));
    return acc;
  }, {});
}

/** ICU argument names used in a message, e.g. "Hi {name}" -> ["name"]. */
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

const locales = { uk: flatten(uk), nb: flatten(nb) };
const source = flatten(en);

describe("message files", () => {
  for (const [name, messages] of Object.entries(locales)) {
    describe(name, () => {
      it("has exactly the same keys as en.json", () => {
        expect(Object.keys(messages).sort()).toEqual(Object.keys(source).sort());
      });

      it("has no empty strings", () => {
        expect(Object.entries(messages).filter(([, v]) => v.trim() === "")).toEqual([]);
      });

      it("uses the same placeholders as en.json for every key", () => {
        const mismatched = Object.keys(source).filter(
          (k) => JSON.stringify(placeholders(messages[k] ?? "")) !== JSON.stringify(placeholders(source[k])),
        );
        expect(mismatched).toEqual([]);
      });
    });
  }

  it("keeps the Discogs attribution wording identical in every language", () => {
    // Prescribed by the API Terms of Use ("Discogs Intellectual Property"): "Data provided by Discogs."
    for (const m of [uk, en, nb]) expect(m.footer.dataProvidedBy).toBe("Data provided by Discogs.");
  });

  it("shows the non-affiliation notice exactly as the Terms prescribe, in every language", () => {
    const required =
      "This application uses Discogs\u2019 API but is not affiliated with, sponsored or endorsed by Discogs. \u2018Discogs\u2019 is a trademark of Zink Media, LLC.";
    for (const m of [uk, en, nb]) expect(m.footer.discogsNotice).toBe(required);
  });
});
