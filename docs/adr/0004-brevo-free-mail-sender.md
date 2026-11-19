# 0004. Email through Brevo with a free-mail sender

**Status:** accepted, with a known cost.

## Context

Email + password sign-up needs verification and password-reset emails. The project has no domain and none will be bought, so SPF, DKIM and
DMARC cannot be authenticated for a sender the operator controls. Resend needs a verified domain; Brevo can send from a validated address
of a free mailbox provider.

## Decision

* Send through Brevo's HTTPS API (`api.brevo.com`, no SMTP, no package). Resend stays behind `EMAIL_PROVIDER=resend` for the day a domain
  exists.
* The sender is a free-mail address the operator validated in Brevo; Brevo replaces it with its own sending domain, and `Reply-To` is the
  public contact address, so replies reach a real inbox.
* The free plan allows 300 emails a day; past it Brevo answers 429. The app keeps working: the account is still created and the person sees
  the same "nothing arrived? check spam" note as everyone else (so the screen never reveals whether an address has an account).
* Two switches reduce the load: `AUTH_EMAIL_PASSWORD_ENABLED=false` (Google only, no email at all) and `AUTH_SIGNUP_ALLOWLIST` (invite only).

## Consequences

* **Mail lands in spam.** This is accepted and said to the user on every screen that sends an email. Mitigations that need no domain are in
  `docs/email-deliverability-test.md`.
* Revisit when a domain is bought: authenticate it in Brevo, change the "nothing arrived" wording and the deliverability test.
