# Security policy

Vinilium is a free, non-commercial hobby project run by one person. There is no bug bounty, but a careful report is welcome and will be
answered.

## Reporting a vulnerability

**Please do not open a public issue or pull request for a security problem.**

1. Use GitHub's private reporting: the repository's **Security** tab > **Report a vulnerability** (if it is enabled for this repository).
2. Or email the operator at the address published on the app's **Contact** page (`/en/contact`). That address is the value of
   `NEXT_PUBLIC_CONTACT_EMAIL` in the deployment; it is deliberately not written in this file.

Please include: what you found, where (URL or file), how to reproduce it, and what you think the impact is. Use test accounts only.
Never include real people's data in a report.

You can expect an acknowledgement within a few days and a fix or an explanation as soon as the operator can manage it. Please give a
reasonable time to fix a problem before you publish it.

## What is in scope

* The web app at the production address and the code in this repository: sign-in and sessions, the API routes under `/api`, the image
  proxy (SSRF), redirects and callback addresses, rate limiting, the data export and account deletion, security headers.
* Leaks of personal data or of secrets.

## What is out of scope

* Denial-of-service and volumetric load testing; automated scanners run against production without agreement.
* Social engineering, physical attacks, and anything against the services the app uses (Discogs, Google, Brevo, Neon, Vercel): report
  those to the provider.
* Emails landing in spam: the sender is a free-mail address on purpose (see `docs/operations.md`).
* Missing HSTS while the site has no custom domain (documented, a deliberate decision).

## Handling

Fixes go to `main`; secrets that may have been exposed are rotated first (see `docs/operations.md`, "Rotating secrets"). The threat
model is in [docs/threat-model.md](docs/threat-model.md) and the Discogs rules the app must keep are in
[docs/discogs-compliance.md](docs/discogs-compliance.md).

## Supported versions

Only the current `main` branch and the version deployed from it.
