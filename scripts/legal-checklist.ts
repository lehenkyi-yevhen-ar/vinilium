/**
 * npm run legal:checklist            writes docs/legal-review-checklist.md
 * npm run legal:checklist -- --check exits 1 while any [NEEDS LEGAL REVIEW] mark remains (use before launch)
 */
import fs from "node:fs";
import path from "node:path";
import type { Messages } from "./lib/i18n-csv";
import { buildChecklist, openMarks } from "./lib/legal-checklist";

const root = path.resolve(__dirname, "..");
const load = (l: string) => JSON.parse(fs.readFileSync(path.join(root, "src", "messages", `${l}.json`), "utf8"));
const messages: Messages = { en: load("en"), uk: load("uk"), nb: load("nb") };
const marks = openMarks(messages);

if (process.argv.includes("--check")) {
  if (marks.length) {
    console.error(`${marks.length} passage(s) still marked for legal review:`);
    for (const m of marks) console.error("  - " + m.key);
    process.exit(1);
  }
  console.log("No legal-review marks left.");
} else {
  const out = path.join(root, "docs", "legal-review-checklist.md");
  fs.writeFileSync(out, buildChecklist(messages), "utf8");
  console.log(`wrote ${path.relative(root, out)}: ${marks.length} open mark(s)`);
}
