import { describe, expect, it } from "vitest";
import en from "@/messages/en.json";
import nb from "@/messages/nb.json";
import uk from "@/messages/uk.json";

/**
 * ICU plural messages must carry every plural category their language needs, and a number must land in the branch its language says.
 * Ukrainian has one / few / many / other (1 album, 2-4 albums, 5-20 albums, 21 album, 22 albums, 1.5 albums); Norwegian Bokmal and English have
 * one / other. A message with only `one` and `other` shows "5 альбом" in Ukrainian, which is wrong.
 */

type Tree = { [k: string]: string | Tree };
const flatten = (t: Tree, prefix = ""): Array<[string, string]> => Object.entries(t).flatMap(([k, v]) => (typeof v === "string" ? [[`${prefix}${k}`, v] as [string, string]] : flatten(v, `${prefix}${k}.`)));

/** The plural selectors of a message: for each `{name, plural, one {...} few {...}}` the category names it defines. */
function pluralCategories(message: string): string[][] {
  const out: string[][] = [];
  const re = /\{[A-Za-z0-9_]+,\s*plural,/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(message))) {
    let depth = 1;
    let i = m.index + m[0].length;
    const start = i;
    while (i < message.length && depth > 0) {
      if (message[i] === "{") depth++;
      else if (message[i] === "}") depth--;
      i++;
    }
    const body = message.slice(start, i - 1);
    const cats: string[] = [];
    let d = 0;
    for (const token of body.matchAll(/([={}])|([A-Za-z0-9=]+)\s*(?=\{)/g)) {
      if (token[1] === "{") d++;
      else if (token[1] === "}") d--;
      else if (token[2] && d === 0) cats.push(token[2]);
    }
    out.push(cats);
  }
  return out;
}

const LOCALES = { en: en as unknown as Tree, uk: uk as unknown as Tree, nb: nb as unknown as Tree };
const NEEDED = { en: ["one", "other"], nb: ["one", "other"], uk: ["one", "few", "many", "other"] } as const;

describe("plural messages", () => {
  const plurals = flatten(LOCALES.en).filter(([, v]) => /plural,/.test(v)).map(([k]) => k);

  it("there are plural messages to check, in all three languages, under the same keys", () => {
    expect(plurals.length).toBeGreaterThanOrEqual(7);
    for (const loc of ["uk", "nb"] as const) {
      const keys = new Set(flatten(LOCALES[loc]).filter(([, v]) => /plural,/.test(v)).map(([k]) => k));
      for (const k of plurals) expect(keys.has(k), `${loc}: ${k} is a plural message`).toBe(true);
    }
  });

  for (const loc of ["en", "nb", "uk"] as const) {
    it(`${loc}: every plural message defines exactly the categories the language needs (${NEEDED[loc].join(", ")})`, () => {
      const flat = Object.fromEntries(flatten(LOCALES[loc]));
      for (const key of plurals) {
        for (const cats of pluralCategories(flat[key])) {
          const named = cats.filter((c) => !c.startsWith("="));
          expect(new Set(named), `${loc}: ${key}`).toEqual(new Set(NEEDED[loc]));
          expect(named, `${loc}: ${key} lists a category twice`).toHaveLength(new Set(named).size);
          expect(named.at(-1), `${loc}: ${key}: "other" comes last`).toBe("other");
        }
      }
    });
  }

  it("the languages' own rules put the numbers where the messages expect them (so the categories above are the right ones)", () => {
    const uk = new Intl.PluralRules("uk");
    const nb = new Intl.PluralRules("nb");
    const en = new Intl.PluralRules("en");
    expect([1, 21, 101].map((n) => uk.select(n))).toEqual(["one", "one", "one"]);
    expect([2, 3, 4, 22, 24].map((n) => uk.select(n))).toEqual(["few", "few", "few", "few", "few"]);
    expect([0, 5, 11, 12, 14, 20, 25, 100].map((n) => uk.select(n))).toEqual(Array(8).fill("many"));
    expect(uk.select(1.5)).toBe("other");
    expect([nb.select(1), nb.select(2), nb.select(0), en.select(1), en.select(5)]).toEqual(["one", "other", "other", "one", "other"]);
  });
});

describe("dates, numbers and lists follow the locale", () => {
  it("formats with the language's own conventions (the app uses Intl, never hand-built strings)", () => {
    const date = new Date(Date.UTC(2026, 10, 18, 12));
    expect(new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" }).format(date)).toBe("Nov 18, 2026");
    expect(new Intl.DateTimeFormat("nb", { dateStyle: "medium", timeZone: "UTC" }).format(date)).toMatch(/18\.\s*nov\.?\s*2026/);
    expect(new Intl.DateTimeFormat("uk", { dateStyle: "medium", timeZone: "UTC" }).format(date)).toMatch(/18\s+лист\./);
    expect(new Intl.NumberFormat("nb").format(1234567.5)).toMatch(/1\s?234\s?567,5/);
    expect(new Intl.NumberFormat("uk").format(1234.5)).toMatch(/1\s?234,5/);
    expect(new Intl.ListFormat("uk", { type: "conjunction" }).format(["А", "Б", "В"])).toBe("А, Б і В");
    expect(new Intl.ListFormat("nb", { type: "conjunction" }).format(["A", "B", "C"])).toBe("A, B og C");
  });
});
