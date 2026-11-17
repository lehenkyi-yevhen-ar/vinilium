/**
 * Native-speaker review package: all uk and nb strings next to the English source in ONE CSV (UTF-8 with BOM, so Excel opens
 * Ukrainian and Norwegian text correctly), and the way back: apply the edited file onto the JSON message files, refusing anything
 * that would break the app (changed placeholders, emptied strings, removed legal marks, edited Discogs-prescribed wording).
 */

export const LOCALES = ["uk", "nb"] as const;
export const SOURCE = "en";
export const COLUMNS = ["key", "context", "English source", "uk", "nb", "placeholders"] as const;
export const LEGAL_MARK = "[NEEDS LEGAL REVIEW]";

/** Wording prescribed by the Discogs API Terms of Use: identical in every language, never edited by a reviewer. */
export const PROTECTED_KEYS = ["footer.dataProvidedBy", "footer.discogsNotice"] as const;

export type Json = { [k: string]: Json | string };
export type Messages = Record<"en" | "uk" | "nb", Json>;

export function flatten(obj: Json, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") out[key] = v;
    else Object.assign(out, flatten(v, key));
  }
  return out;
}

/** Sets obj[a.b.c] = value where the path already exists (never creates keys). Returns false if the path is missing. */
function setExisting(obj: Json, key: string, value: string): boolean {
  const parts = key.split(".");
  let node: Json = obj;
  for (const part of parts.slice(0, -1)) {
    const next = node[part];
    if (!next || typeof next === "string") return false;
    node = next;
  }
  const last = parts[parts.length - 1];
  if (typeof node[last] !== "string") return false;
  node[last] = value;
  return true;
}

// ---------------------------------------------------------------------------------------------------------------------------
// ICU placeholders: {name}, {count, plural, one {# item} other {# items}}, {x, select, ...}, including nested arguments

/** Index just past the "}" that closes the "{" at `open` (or text.length when unbalanced). */
function closeOf(text: string, open: number): number {
  let depth = 1;
  let j = open + 1;
  while (j < text.length && depth > 0) {
    if (text[j] === "{") depth++;
    else if (text[j] === "}") depth--;
    j++;
  }
  return j;
}

export function placeholders(message: string): string[] {
  const names = new Set<string>();

  /** Scans running text for arguments. */
  const scan = (text: string) => {
    let i = 0;
    while (i < text.length) {
      if (text[i] !== "{") {
        i++;
        continue;
      }
      const end = closeOf(text, i);
      const inner = text.slice(i + 1, text[end - 1] === "}" ? end - 1 : end);
      const head = /^\s*([A-Za-z_]\w*)\s*(,|$)/.exec(inner);
      if (head) {
        names.add(head[1]);
        const kind = head[2] ? /^\s*,\s*(plural|select|selectordinal)\s*,/.exec(inner.slice(head[0].length - 1)) : null;
        if (kind) scanOptions(inner.slice(head[0].length - 1 + kind[0].length));
      }
      i = end;
    }
  };

  /** plural/select options are `selector {body}` pairs; the bodies are running text again. */
  const scanOptions = (text: string) => {
    let i = 0;
    while (i < text.length) {
      const open = text.indexOf("{", i);
      if (open < 0) return;
      const end = closeOf(text, open);
      scan(text.slice(open + 1, text[end - 1] === "}" ? end - 1 : end));
      i = end;
    }
  };

  scan(message);
  return [...names].sort();
}

export const samePlaceholders = (a: string, b: string) => JSON.stringify(placeholders(a)) === JSON.stringify(placeholders(b));

// ---------------------------------------------------------------------------------------------------------------------------
// Context hints for reviewers

const NAMESPACE_CONTEXT: Record<string, string> = {
  meta: "Page title and description of the site",
  common: "Shared labels and buttons",
  nav: "Header and phone tab bar",
  locales: "Language names",
  home: "Home page",
  auth: "Sign-in, sign-up and password screens",
  account: "Account page",
  footer: "Footer (Discogs wording is prescribed: do not change)",
  states: "Generic loading, error and empty states",
  notFound: "Page not found",
  email: "Emails we send (verification, password reset)",
  contact: "Contact page",
  signInRequired: "'Sign in to continue' screen",
  finder: "Search: track, artist and album steps",
  pressings: "Search: pressings of an album",
  release: "Release card",
  lists: "Add to Wishlist / Collection buttons on a release",
  discogsStates: "Waiting / error messages while loading Discogs data",
  library: "My lists screen (Wishlist and Collection)",
  legal: "Privacy policy and terms of use (LEGAL TEXT: needs legal review as well)",
  signUpConsent: "Sign-up form: consent sentence with links",
};

export function contextFor(key: string): string {
  const [ns, ...rest] = key.split(".");
  const base = NAMESPACE_CONTEXT[ns] ?? ns;
  return rest.length ? `${base} - ${rest.join(" > ")}` : base;
}

// ---------------------------------------------------------------------------------------------------------------------------
// CSV (RFC 4180)

export function csvEscape(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function stringifyCsv(rows: string[][]): string {
  return "﻿" + rows.map((r) => r.map(csvEscape).join(",")).join("\r\n") + "\r\n";
}

export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"' && field === "") quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

// ---------------------------------------------------------------------------------------------------------------------------
// Export and import

export function buildExportRows(messages: Messages): string[][] {
  const en = flatten(messages.en);
  const uk = flatten(messages.uk);
  const nb = flatten(messages.nb);
  const rows: string[][] = [[...COLUMNS]];
  for (const key of Object.keys(en)) {
    rows.push([key, contextFor(key), en[key], uk[key] ?? "", nb[key] ?? "", placeholders(en[key]).join(" ")]);
  }
  return rows;
}

export interface ImportResult {
  /** The messages with the reviewer's edits applied (always computed, but only trust it when `errors` is empty). */
  messages: Messages;
  changes: Array<{ key: string; locale: (typeof LOCALES)[number] }>;
  errors: string[];
  rows: number;
}

export function applyCsv(csvText: string, current: Messages): ImportResult {
  const messages = JSON.parse(JSON.stringify(current)) as Messages;
  const en = flatten(current.en);
  const have = { uk: flatten(current.uk), nb: flatten(current.nb) };
  const errors: string[] = [];
  const changes: ImportResult["changes"] = [];
  const table = parseCsv(csvText);
  const head = table[0] ?? [];
  const col = Object.fromEntries(COLUMNS.map((c) => [c, head.indexOf(c)])) as Record<(typeof COLUMNS)[number], number>;
  for (const c of COLUMNS) if (col[c] < 0) errors.push(`the header has no "${c}" column`);
  if (errors.length) return { messages: current, changes, errors, rows: 0 };

  const seen = new Set<string>();
  for (const [index, row] of table.slice(1).entries()) {
    const line = index + 2;
    const key = row[col.key];
    if (!key) {
      errors.push(`line ${line}: empty key`);
      continue;
    }
    if (seen.has(key)) errors.push(`line ${line}: duplicate key ${key}`);
    seen.add(key);
    if (!(key in en)) {
      errors.push(`line ${line}: ${key} does not exist in en.json`);
      continue;
    }
    if (row[col["English source"]] !== en[key]) {
      errors.push(`line ${line}: the English source of ${key} changed since this file was exported: export a fresh file`);
      continue;
    }
    for (const locale of LOCALES) {
      const next = row[col[locale]] ?? "";
      if (next === have[locale][key]) continue;
      if (PROTECTED_KEYS.includes(key as (typeof PROTECTED_KEYS)[number])) {
        errors.push(`line ${line}: ${key} is prescribed wording and must not be changed (${locale})`);
        continue;
      }
      if (next.trim() === "") {
        errors.push(`line ${line}: ${key} (${locale}) is empty`);
        continue;
      }
      if (!samePlaceholders(next, en[key])) {
        errors.push(`line ${line}: ${key} (${locale}) changes the placeholders: expected {${placeholders(en[key]).join("}, {")}}, found {${placeholders(next).join("}, {")}}`);
        continue;
      }
      if (en[key].includes(LEGAL_MARK) && !next.includes(LEGAL_MARK)) {
        errors.push(`line ${line}: ${key} (${locale}) lost the ${LEGAL_MARK} mark: only the operator's lawyer removes it`);
        continue;
      }
      if (!setExisting(messages[locale], key, next)) {
        errors.push(`line ${line}: ${key} (${locale}) is not in ${locale}.json`);
        continue;
      }
      changes.push({ key, locale });
    }
  }
  for (const key of Object.keys(en)) if (!seen.has(key)) errors.push(`${key} is missing from the file (do not delete rows)`);
  return { messages: errors.length ? current : messages, changes, errors, rows: seen.size };
}
