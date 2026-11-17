/**
 * npm run i18n:import -- <edited.csv> [--write]
 * Checks the reviewed file and applies it to src/messages/uk.json and nb.json. Without --write it only reports what WOULD change
 * (a dry run). Nothing is written if any check fails: changed placeholders, emptied strings, removed legal marks, edited
 * Discogs-prescribed wording, a stale English source, missing or unknown rows.
 */
import fs from "node:fs";
import path from "node:path";
import { applyCsv, LOCALES, type Messages } from "./lib/i18n-csv";

const args = process.argv.slice(2);
const write = args.includes("--write");
const file = args.find((a) => !a.startsWith("--"));
if (!file) {
  console.error("usage: npm run i18n:import -- <edited.csv> [--write]");
  process.exit(2);
}

const root = path.resolve(__dirname, "..");
const load = (l: string) => JSON.parse(fs.readFileSync(path.join(root, "src", "messages", `${l}.json`), "utf8"));
const current: Messages = { en: load("en"), uk: load("uk"), nb: load("nb") };

const result = applyCsv(fs.readFileSync(path.resolve(file), "utf8"), current);

if (result.errors.length) {
  console.error(`REFUSED: ${result.errors.length} problem(s); nothing was changed.`);
  for (const e of result.errors.slice(0, 50)) console.error("  - " + e);
  if (result.errors.length > 50) console.error(`  ... and ${result.errors.length - 50} more`);
  process.exit(1);
}

const per = Object.fromEntries(LOCALES.map((l) => [l, result.changes.filter((c) => c.locale === l).length]));
console.log(`${result.rows} rows checked; ${result.changes.length} change(s): ${LOCALES.map((l) => `${l} ${per[l]}`).join(", ")}.`);
for (const c of result.changes.slice(0, 200)) console.log(`  ${c.locale}  ${c.key}`);

if (!write) {
  console.log("Dry run: nothing written. Add --write to apply.");
} else if (result.changes.length === 0) {
  console.log("Nothing to apply.");
} else {
  for (const l of LOCALES) fs.writeFileSync(path.join(root, "src", "messages", `${l}.json`), JSON.stringify(result.messages[l], null, 2) + "\n", "utf8");
  console.log("Written. Run `npm test` (the messages tests check keys and placeholders) before committing.");
}
