/**
 * The audit gate: fail on any NEW high or critical advisory, pass (with a warning) on an explicit, reviewed, expiring allowlist keyed by
 * advisory id. Pure (no I/O) so it is unit-tested; scripts/audit-gate.ts runs `npm audit` and applies it.
 *
 * Why not `npm audit --audit-level=high` alone: it cannot say "this one advisory, reviewed on this day, for this reason, until that date".
 * Why not a blanket ignore: an entry covers ONE advisory id, must carry a justification, and stops working on its expiry date, after which the
 * gate fails again until someone re-reviews it.
 */

export type Severity = "info" | "low" | "moderate" | "high" | "critical";
const RANK: Record<Severity, number> = { info: 0, low: 1, moderate: 2, high: 3, critical: 4 };

export interface AllowEntry {
  /** GitHub advisory id, e.g. GHSA-xxxx-xxxx-xxxx. */
  id: string;
  /** The package it is about (for the reader). */
  package: string;
  /** Why it is acceptable: the real impact for this app, and why there is no fix to apply. */
  justification: string;
  /** Last day (YYYY-MM-DD, inclusive) on which this exception is valid. */
  expires: string;
  /** Who looked at it, and when (YYYY-MM-DD). */
  reviewed: string;
}

export interface Advisory {
  id: string;
  package: string;
  severity: Severity;
  title: string;
  url: string;
}

export interface GateResult {
  failures: Advisory[];
  allowed: Array<{ advisory: Advisory; entry: AllowEntry }>;
  /** Advisories below the gate's threshold: listed, never failing. */
  below: Advisory[];
  expired: AllowEntry[];
  /** Allowlist entries that match nothing any more (the advisory was fixed or the package left): remove them. */
  stale: AllowEntry[];
  invalid: string[];
  ok: boolean;
}

/** The advisories in the JSON of `npm audit --json` (npm 7+), one per advisory id however many packages reach it. */
export function advisoriesFrom(report: unknown): Advisory[] {
  const out = new Map<string, Advisory>();
  const vulns = (report as { vulnerabilities?: Record<string, { via?: unknown[] }> } | null)?.vulnerabilities ?? {};
  for (const [name, v] of Object.entries(vulns)) {
    for (const via of v.via ?? []) {
      if (!via || typeof via !== "object") continue; // a string is "reached through another vulnerable package"
      const a = via as { source?: number; name?: string; title?: string; url?: string; severity?: string };
      const url = String(a.url ?? "");
      const id = /GHSA-[a-z0-9-]+/i.exec(url)?.[0] ?? (a.source !== undefined ? String(a.source) : "");
      if (!id || !(a.severity && a.severity in RANK)) continue;
      if (!out.has(id)) out.set(id, { id, package: a.name ?? name, severity: a.severity as Severity, title: String(a.title ?? ""), url });
    }
  }
  return [...out.values()].sort((x, y) => RANK[y.severity] - RANK[x.severity] || x.id.localeCompare(y.id));
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function validateAllowlist(entries: unknown): { entries: AllowEntry[]; invalid: string[] } {
  const invalid: string[] = [];
  const good: AllowEntry[] = [];
  if (!Array.isArray(entries)) return { entries: [], invalid: ["the allowlist must be a JSON array"] };
  const seen = new Set<string>();
  for (const [i, e] of entries.entries()) {
    const x = e as Partial<AllowEntry> | null;
    const where = `entry ${i + 1}${x?.id ? ` (${x.id})` : ""}`;
    if (!x || typeof x !== "object") invalid.push(`${where}: not an object`);
    else if (!x.id || !/^GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/i.test(x.id)) invalid.push(`${where}: id must be a single GHSA advisory id (no wildcards, no package-wide ignores)`);
    else if (seen.has(x.id)) invalid.push(`${where}: duplicate id`);
    else if (!x.package) invalid.push(`${where}: package is required`);
    else if (!x.justification || x.justification.trim().length < 40) invalid.push(`${where}: justification is required (at least 40 characters: the real impact and why no fix applies)`);
    else if (!x.expires || !DAY.test(x.expires)) invalid.push(`${where}: expires must be YYYY-MM-DD`);
    else if (!x.reviewed || !DAY.test(x.reviewed)) invalid.push(`${where}: reviewed must be YYYY-MM-DD`);
    else if (x.expires < x.reviewed) invalid.push(`${where}: expires is before reviewed`);
    else {
      seen.add(x.id);
      good.push(x as AllowEntry);
    }
  }
  return { entries: good, invalid };
}

export function evaluate(advisories: Advisory[], allowlist: unknown, opts: { threshold?: Severity; today?: string } = {}): GateResult {
  const threshold = opts.threshold ?? "high";
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const { entries, invalid } = validateAllowlist(allowlist);
  const byId = new Map(entries.map((e) => [e.id.toUpperCase(), e]));

  const result: GateResult = { failures: [], allowed: [], below: [], expired: [], stale: [], invalid, ok: false };
  const matched = new Set<string>();
  for (const a of advisories) {
    if (RANK[a.severity] < RANK[threshold]) {
      result.below.push(a);
      continue;
    }
    const entry = byId.get(a.id.toUpperCase());
    if (!entry) result.failures.push(a);
    else if (entry.expires < today) {
      result.expired.push(entry);
      result.failures.push(a);
      matched.add(entry.id.toUpperCase());
    } else {
      result.allowed.push({ advisory: a, entry });
      matched.add(entry.id.toUpperCase());
    }
  }
  result.stale = entries.filter((e) => !matched.has(e.id.toUpperCase()) && !advisories.some((a) => a.id.toUpperCase() === e.id.toUpperCase()));
  result.ok = result.failures.length === 0 && invalid.length === 0;
  return result;
}

/** Plain-text report; on GitHub Actions the caller prefixes warnings and errors as workflow commands. */
export function report(r: GateResult): { lines: string[]; warnings: string[]; errors: string[] } {
  const lines: string[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];
  for (const a of r.failures) errors.push(`${a.severity.toUpperCase()} ${a.id} in ${a.package}: ${a.title} (${a.url}) is not on the reviewed allowlist (.audit-allowlist.json)`);
  for (const e of r.expired) errors.push(`the exception for ${e.id} expired on ${e.expires}: review it again, then extend or remove it`);
  for (const msg of r.invalid) errors.push(`.audit-allowlist.json: ${msg}`);
  for (const { advisory: a, entry } of r.allowed) warnings.push(`${a.severity.toUpperCase()} ${a.id} in ${a.package} is allowed until ${entry.expires} (reviewed ${entry.reviewed}): ${entry.justification}`);
  for (const e of r.stale) warnings.push(`the allowlist entry ${e.id} (${e.package}) matches no advisory any more: remove it`);
  for (const a of r.below) lines.push(`below the threshold: ${a.severity} ${a.id} in ${a.package}: ${a.title}`);
  return { lines, warnings, errors };
}
