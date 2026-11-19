import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import * as schema from "@/server/db/schema";

/**
 * docs/data-inventory.md must list every column of every table, with no extra and no missing. Add a column to the schema and this test
 * fails until the inventory says whether it is personal data, why it exists, how long it is kept and where it is deleted.
 */

const doc = readFileSync(path.resolve(__dirname, "../../docs/data-inventory.md"), "utf8");

const tables = (Object.values(schema).filter((v) => v instanceof PgTable) as PgTable[]).map((t) => getTableConfig(t));
const actual = new Set(tables.flatMap((t) => t.columns.map((c) => `${t.name}.${c.name}`)));

/** `table.column` tokens in backticks, as the inventory writes them. */
const documented = new Set([...doc.matchAll(/`([a-z_]+\.[a-z_]+)`/g)].map((m) => m[1]).filter((id) => tables.some((t) => id.startsWith(`${t.name}.`))));

describe("docs/data-inventory.md", () => {
  it("the schema has the tables this test expects (so a new table cannot hide from it)", () => {
    expect(tables.map((t) => t.name).sort()).toEqual(["account", "discogs_bucket", "discogs_cache", "rate_limit", "session", "user", "user_items", "verification"]);
  });

  it("lists every column in the schema", () => {
    const missing = [...actual].filter((c) => !documented.has(c)).sort();
    expect(missing, "columns in the schema but not in docs/data-inventory.md: say whether each is personal data, why it exists, its retention and where it is deleted").toEqual([]);
  });

  it("lists no column that does not exist (a renamed or dropped column must be removed from the inventory too)", () => {
    const stale = [...documented].filter((c) => !actual.has(c)).sort();
    expect(stale).toEqual([]);
  });

  it("has a section per table, and each says whether its columns are personal", () => {
    for (const t of tables) expect(doc, t.name).toMatch(new RegExp(`### \`${t.name}\``));
    expect(doc).toMatch(/Personal\?/);
    expect(doc).toMatch(/Retention/);
    expect(doc).toMatch(/Deleted by/);
  });

  it("every foreign key to the user cascades, so account deletion cannot leave a row behind", () => {
    for (const t of tables) {
      for (const fk of t.foreignKeys) {
        const ref = fk.reference();
        if (getTableConfig(ref.foreignTable).name === "user") expect(fk.onDelete, `${t.name}.${ref.columns.map((c) => c.name).join(",")}`).toBe("cascade");
      }
    }
  });

  it("tables that are not linked to the user by a key say how they are cleaned instead", () => {
    const linked = new Set(tables.filter((t) => t.foreignKeys.some((fk) => getTableConfig(fk.reference().foreignTable).name === "user")).map((t) => t.name));
    for (const name of ["verification", "rate_limit"]) {
      expect(linked.has(name), `${name} has a key to user: update the inventory`).toBe(false);
      expect(doc).toMatch(new RegExp(`### \`${name}\`[\\s\\S]*?(purge|\\(b\\))`));
    }
  });
});
