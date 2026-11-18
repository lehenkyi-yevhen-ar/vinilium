# Decisions needed from the owner

These are product or policy choices that are yours. Nothing here has been implemented except where a row says so. Each has options and a
recommendation; reply with the number and the choice, or ignore the ones you are happy to leave as they are.

## 1. Which sign-in methods stay open

| Option | What changes | Cost |
| --- | --- | --- |
| **A. Keep email + password and Google, open sign-up (today)** | nothing | Every sign-up sends an email; the free Brevo plan stops at 300 a day, and mail lands in spam (ADR 0004). A script can use the quota up in minutes |
| B. Email + password plus `AUTH_SIGNUP_ALLOWLIST` (invite only) | you list the people | You maintain a list; nobody else can join |
| C. Google only (`AUTH_EMAIL_PASSWORD_ENABLED=false`) | no email is sent at all; no password to leak | Everyone needs a Google account; password-only accounts cannot sign in (whether they can come back through Google with the same email is **untested**) |

**Recommendation: A for now, with the switches ready.** Watch `[email] ... reason=rate_limited` in the logs for a few weeks. If the quota is ever
reached, or sign-ups start looking like abuse, flip to B or C in Vercel and redeploy (operations.md, section 15). It needs no code change.

## 2. When to turn the CSP from report-only to enforcing

`CSP_MODE=enforce` is built, tested in a real browser on every page and language, and the whole e2e suite was run with it (see the run report).
**Recommendation: deploy as is (report-only), read `[csp-report]` in the Vercel logs for about a week of normal use, then set `CSP_MODE=enforce`
and redeploy.** Rollback is deleting the variable and redeploying. Steps: operations.md, section 10. Trade-off: enforcing also blocks the scripts
that some browser extensions inject, so one person's extension may stop working on this site.

## 3. HSTS

Off by default. It must only be switched on once every page, the Google redirect and email links work over HTTPS, and a browser remembers it for the
whole period. Without a custom domain there is no `includeSubDomains` question, but you also cannot undo it quickly for a host you do not
control. **Recommendation: leave it unset until a domain exists, then 300, 86400, 31536000 in steps** (operations.md, section 10).

## 4. Sessions and "sign out other devices"

Better Auth supports listing sessions and revoking the others without a new dependency. A session row stores an IP address and a browser
description, which is why showing them is a privacy decision as well as a UI one. **Recommendation: show the browser description and the
date only (never the IP address), with a "Sign out other devices" button.** **Status: not implemented** in this run (it needs new strings in three languages and a design pass; Better Auth's `listSessions` and `revokeOtherSessions` are available when you decide).

## 5. Do you want search engines to index the site?

`robots.txt` and `sitemap.xml` now exist and expose only the public pages (home, contact, privacy, terms in three languages); the app screens and
the API are disallowed. Open Graph tags are on the public pages only. **Recommendation: keep as is.** If you prefer the site not to be indexed at all, change
`robots.ts` to `disallow: "/"` and remove `sitemap.ts` (one commit).

## 5b. Repository visibility

The repository is private. CodeQL and secret scanning on GitHub are free for public repositories; for a private one they need GitHub Advanced
Security (a paid feature on organisations; on a personal private repository check what your plan includes). The CodeQL workflow may fail to
upload results while the repository is private and without that feature. **Recommendation: stay private until the legal review is done and the
Discogs Terms question about public code is settled, and judge the CodeQL result when the first run appears.** Dependabot version updates work on
private repositories; the gitleaks job works on a personal account.

## 6. Two-factor sign-in or passkeys

Not built. **Recommendation: not now.** The data is a wishlist; the risk is low and each factor adds support work for one operator. Revisit if
the app grows past friends.

## 6b. `npm run audit:prod` is red today (found 2026-11-18)

`npm audit --omit=dev --audit-level=high` exits 1 with **6 high and 4 moderate** findings. The high ones are the picomatch ReDoS advisory, which
npm lists as affecting every version (`*`) with **no patched release**: the installed 4.0.7 is already the latest. It is reached through
`better-auth`'s optional peer `vitest` and `next-intl`'s `@parcel/watcher` (file watching at development time), not through a request path, but that
reading is mine and was not verified in the code of those packages. The moderates are `esbuild` through `drizzle-kit` (a build-time tool). No
dependency was changed in this run (the suggested "fixes" are downgrades: `drizzle-kit@0.18.1`, `vitest@3.1.4`). **The `audit` job in CI will therefore fail on GitHub until
you decide.** Options: (a) leave it red and re-check weekly (Dependabot will propose a fix when one exists); (b) change the gate to
`--audit-level=critical` meanwhile (weakens it: your call); (c) add an explicit, dated exception for this one advisory.
**Recommendation: (c) if npm supports the exception you want, otherwise (a); do not silently lower the level.**

## 7. Items only you can check (not decisions, but open)

* **Discogs "Application Name and Description Policy"**: it was not part of the pasted Terms. Check that the app name and the description
  registered at Discogs comply.
* **`APP_CONTACT`**: becomes `https://<domain>/en/contact` once a domain exists; today it is a placeholder.
* **The Lis design-system licence and the font credits** (Ermilov, KyivType Sans CC BY-ND 4.0): confirm the licence of the vendored files and that the
  credit shown in the footer is what the licences ask for.
* **Native-speaker review** of the Ukrainian and Norwegian text, including the strings written in this run: `docs/i18n/doubtful-strings.md`.
* **Every `[NEEDS LEGAL REVIEW]` mark** (`npm run legal:checklist`), including the new one about how long Vercel keeps server logs.
