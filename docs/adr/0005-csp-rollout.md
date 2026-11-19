# 0005. A nonce-based Content-Security-Policy, report-only first

**Status:** accepted. Default `CSP_MODE=report-only`; enforcement is a switch, not a rewrite.

## Context

The first CSP was report-only and allowed `'unsafe-inline'` scripts, so it would have stopped almost nothing. Next.js needs inline scripts for
its bootstrap and the page had one inline theme script. A policy without `'unsafe-inline'` needs a per-request nonce, or hashes.

## Decision

* `src/proxy.ts` creates a 128-bit nonce for every page request and sets the policy on the **request** (so Next.js puts the nonce on its own
  inline scripts, bundles and `<Script>`) and on the **response** (what the browser reads). Any CSP header a client sends is discarded.
  Every page is rendered per request (the layout reads the session), which a nonce needs.
* `script-src 'self' 'nonce-…'`: no `'unsafe-inline'`, no `'unsafe-eval'` in production, no `'strict-dynamic'` (we load nothing from another
  origin). Everything else is `'self'`; objects, framing and base-uri are closed; violations go to `/api/csp-report` (logged as `[csp-report]`).
* The theme script is a static file (`/theme-init.js`), not an inline script, so no hash has to be kept in step with it. Unknown URLs render a
  404 inside the normal layout (`[locale]/[...rest]` + `not-found.tsx`), because the static global 404 cannot carry a nonce.
* Zod's client-side `Function("")` probe is switched off (`jitless`), because under a policy without `'unsafe-eval'` it files a report each time.
* **Styles keep `'unsafe-inline'`**: React and the design system emit `style=""` attributes, which a nonce cannot cover. CSS injection is a far
  smaller risk than script injection. Tightening it (`style-src-attr`) is a possible later step.
* `CSP_MODE=report-only` (default) sends the strict policy as `Content-Security-Policy-Report-Only`; `CSP_MODE=enforce` sends the same
  policy as `Content-Security-Policy`. Only the exact value `enforce` enforces.

## Evidence before flipping the switch

`tests/e2e/csp.spec.ts` loads every page in all three languages, signed out and in, with a `securitypolicyviolation` listener and asserts zero
violations and a nonce on every inline script; the whole e2e suite was run once with `CSP_MODE=enforce` (result in
`docs/autonomous-run-report.md`). Rollout and rollback steps are in `docs/operations.md` section 10.

## Consequences

* An enforcing policy blocks a browser extension's injected scripts too; their reports are noise.
* Every new page must stay dynamic and every new inline script is a bug. A unit test fails if an inline script is added to the source.
* HSTS and `upgrade-insecure-requests` are a separate decision (HTTPS everywhere first).
