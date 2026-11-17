import { describe, expect, it } from "vitest";
import en from "@/messages/en.json";
import nb from "@/messages/nb.json";
import uk from "@/messages/uk.json";
import { applyCsv, buildExportRows, COLUMNS, flatten, LEGAL_MARK, parseCsv, placeholders, samePlaceholders, stringifyCsv, type Messages } from "../../scripts/lib/i18n-csv";
import { buildChecklist, openMarks } from "../../scripts/lib/legal-checklist";

const real = (): Messages => JSON.parse(JSON.stringify({ en, uk, nb }));
const csvOf = (m: Messages) => stringifyCsv(buildExportRows(m));
/** Edit one cell of one row of an exported CSV (by key and column name). */
function edit(csv: string, key: string, column: (typeof COLUMNS)[number], value: string) {
  const rows = parseCsv(csv);
  const col = rows[0].indexOf(column);
  const row = rows.find((r) => r[0] === key)!;
  row[col] = value;
  return stringifyCsv(rows);
}

describe("placeholders", () => {
  it("finds simple, plural and nested arguments", () => {
    expect(placeholders("Hello {name}")).toEqual(["name"]);
    expect(placeholders("{count, plural, one {# record} other {# records}} for “{q}”")).toEqual(["count", "q"]);
    expect(placeholders("{n, plural, one {{who} has # item} other {{who} have # items}}")).toEqual(["n", "who"]);
    expect(placeholders("{kind, select, a {x} other {y}}")).toEqual(["kind"]);
    expect(placeholders("No arguments, just # and text")).toEqual([]);
  });

  it("compares sets, not order", () => {
    expect(samePlaceholders("{a} and {b}", "{b} en {a}")).toBe(true);
    expect(samePlaceholders("{a}", "{a} {b}")).toBe(false);
    expect(samePlaceholders("{count}", "{cnt}")).toBe(false);
  });
});

describe("CSV format", () => {
  it("starts with a BOM, uses CRLF, and round-trips quotes, commas, newlines and non-Latin text", () => {
    const rows = [["key", "text"], ["a", 'say "hi", ok'], ["b", "line1\nline2"], ["c", "Привіт, світе – æøå"]];
    const text = stringifyCsv(rows);
    expect(text.charCodeAt(0)).toBe(0xfeff);
    expect(text).toContain("\r\n");
    expect(parseCsv(text)).toEqual(rows);
  });

  it("accepts a file saved by a spreadsheet without the BOM or with LF line endings", () => {
    expect(parseCsv("a,b\nc,d\n")).toEqual([["a", "b"], ["c", "d"]]);
    expect(parseCsv("﻿a,b\r\nc,d")).toEqual([["a", "b"], ["c", "d"]]);
  });
});

describe("export", () => {
  it("has the agreed columns and one row per string, in English order, with context and placeholders", () => {
    const rows = buildExportRows(real());
    expect(rows[0]).toEqual(["key", "context", "English source", "uk", "nb", "placeholders"]);
    expect(rows.length - 1).toBe(Object.keys(flatten(en)).length);
    const row = rows.find((r) => r[0] === "library.summaryFiltered")!;
    expect(row[1]).toMatch(/My lists screen/);
    expect(row[5]).toBe("count q");
    expect(row[3]).toBe(flatten(uk)["library.summaryFiltered"]);
    expect(row[4]).toBe(flatten(nb)["library.summaryFiltered"]);
  });
});

describe("import", () => {
  it("an unedited export changes nothing", () => {
    const r = applyCsv(csvOf(real()), real());
    expect(r.errors).toEqual([]);
    expect(r.changes).toEqual([]);
    expect(r.messages).toEqual(real());
  });

  it("applies a reviewer's edit to the right file and key, and leaves everything else (and key order) alone", () => {
    const edited = edit(csvOf(real()), "common.save", "uk", "Зберегти зміни");
    const r = applyCsv(edited, real());
    expect(r.errors).toEqual([]);
    expect(r.changes).toEqual([{ key: "common.save", locale: "uk" }]);
    expect((r.messages.uk as { common: { save: string } }).common.save).toBe("Зберегти зміни");
    expect(r.messages.nb).toEqual(nb);
    expect(r.messages.en).toEqual(en);
    expect(Object.keys(r.messages.uk)).toEqual(Object.keys(uk));
  });

  it("edits to plural messages keep working when the placeholders are intact", () => {
    const key = "library.summary";
    const edited = edit(csvOf(real()), key, "nb", "{count, plural, one {# plate i listen} other {# plater i listen}}");
    const r = applyCsv(edited, real());
    expect(r.errors).toEqual([]);
    expect(r.changes).toEqual([{ key, locale: "nb" }]);
  });

  it("REFUSES a change to the placeholders, an empty string, an edit of the Discogs wording and a removed legal mark", () => {
    const base = csvOf(real());
    const bad = [
      edit(base, "library.summaryFiltered", "uk", "{count} платівок за запитом «{query}»"),
      edit(base, "common.save", "nb", "   "),
      edit(base, "footer.dataProvidedBy", "uk", "Дані надано Discogs."),
      edit(base, "footer.discogsNotice", "nb", "Ikke tilknyttet Discogs."),
      edit(base, "legal.privacy.s1P2", "uk", "Тут треба вказати правовий статус оператора."),
    ];
    const messages = bad.map((csv) => applyCsv(csv, real()));
    for (const r of messages) {
      expect(r.errors.length).toBeGreaterThan(0);
      expect(r.messages, "nothing is applied when anything is wrong").toEqual(real());
    }
    expect(messages[0].errors[0]).toMatch(/placeholders/);
    expect(messages[1].errors[0]).toMatch(/empty/);
    expect(messages[2].errors[0]).toMatch(/prescribed wording/);
    expect(messages[4].errors[0]).toMatch(/mark/);
  });

  it("REFUSES a stale file (the English source changed), unknown keys, deleted rows, duplicates and a broken header", () => {
    const base = csvOf(real());
    expect(applyCsv(edit(base, "common.save", "English source", "Persist"), real()).errors[0]).toMatch(/English source .* changed/);

    const rows = parseCsv(base);
    expect(applyCsv(stringifyCsv([...rows, ["no.such.key", "", "x", "y", "z", ""]]), real()).errors.join(" ")).toMatch(/does not exist in en\.json/);
    expect(applyCsv(stringifyCsv(rows.filter((r) => r[0] !== "common.save")), real()).errors.join(" ")).toMatch(/common\.save is missing/);
    expect(applyCsv(stringifyCsv([...rows, rows[1]]), real()).errors.join(" ")).toMatch(/duplicate key/);
    expect(applyCsv(stringifyCsv(rows.map((r) => r.slice(0, 3))), real()).errors.join(" ")).toMatch(/no "uk" column/);
  });

  it("a file saved in another column order still imports (columns are found by name)", () => {
    const rows = parseCsv(csvOf(real()));
    const order = [0, 3, 1, 2, 4, 5];
    const swapped = rows.map((r) => order.map((i) => r[i]));
    const idx = swapped[0].indexOf("uk");
    swapped.find((r) => r[0] === "common.save")![idx] = "Зберегти зміни";
    const r = applyCsv(stringifyCsv(swapped), real());
    expect(r.errors).toEqual([]);
    expect(r.changes).toEqual([{ key: "common.save", locale: "uk" }]);
  });
});

describe("legal-review marks", () => {
  it("every passage marked in one language is marked in all three (a mark belongs to the passage, not the language)", () => {
    const marks = openMarks({ en, uk, nb } as unknown as Messages);
    expect(marks.length).toBeGreaterThan(0);
    expect(marks.filter((m) => m.missingIn.length).map((m) => `${m.key} missing in ${m.missingIn.join(",")}`)).toEqual([]);
  });

  it("the checklist lists every mark, the operator placeholders and the --check gate", () => {
    const text = buildChecklist({ en, uk, nb } as unknown as Messages);
    const marks = openMarks({ en, uk, nb } as unknown as Messages);
    expect(text).toContain(`Open marks: ${marks.length}`);
    for (const m of marks) expect(text).toContain(`\`${m.key}\``);
    expect(text).toContain("NEXT_PUBLIC_OPERATOR_NAME");
    expect(text).toContain("legal:checklist -- --check");
    expect(text).not.toContain(LEGAL_MARK + " " + LEGAL_MARK);
  });

  it("a checklist with nothing marked says zero", () => {
    const clean: Messages = { en: { a: "x" }, uk: { a: "y" }, nb: { a: "z" } };
    expect(buildChecklist(clean)).toContain("Open marks: 0");
  });
});
