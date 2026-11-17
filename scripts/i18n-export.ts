/**
 * npm run i18n:export  ->  docs/i18n/review-uk-nb.csv
 * UTF-8 with BOM; columns: key, context, English source, uk, nb, placeholders. Send it to the native speakers, then apply the
 * edited file with `npm run i18n:import -- <file> --write`.
 */
import fs from "node:fs";
import path from "node:path";
import { buildExportRows, stringifyCsv, type Messages } from "./lib/i18n-csv";

const root = path.resolve(__dirname, "..");
const load = (l: string) => JSON.parse(fs.readFileSync(path.join(root, "src", "messages", `${l}.json`), "utf8"));
const messages: Messages = { en: load("en"), uk: load("uk"), nb: load("nb") };

const rows = buildExportRows(messages);
const out = path.join(root, "docs", "i18n", "review-uk-nb.csv");
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, stringifyCsv(rows), "utf8");
console.log(`wrote ${path.relative(root, out)}: ${rows.length - 1} strings`);
