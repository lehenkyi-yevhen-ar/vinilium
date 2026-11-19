# Email deliverability: a test plan you run by hand

Why this exists: the service sends verification and password-reset emails through **Brevo** from a **free-mail sender address**
(for example a Gmail address). Free-mail domains cannot be authenticated by a third party (you cannot add Brevo's DKIM record to
gmail.com), so Brevo shows a compliance warning and, as a stopgap, **replaces the From address with a `brevosend.com` address**.
That can land verification emails in spam. This plan finds out how bad it is in practice, before you invite anyone.

What the app does to help (already built): the sender name is the project name, **Reply-To is `NEXT_PUBLIC_CONTACT_EMAIL`** with the
display name "Vinilium contact" (so a reply reaches your real inbox), emails are short, plain, localized, with a plain-text part, and
the pages tell people to check their spam folder. **Do not try to fake DKIM or DMARC for a free-mail domain**: it cannot work and
looks worse to filters than being honest.

## Before you start

* The Brevo variables are set in Vercel and the site is **redeployed** (`BREVO_API_KEY`, `EMAIL_FROM`, `EMAIL_FROM_NAME`,
  `EMAIL_PROVIDER=brevo`, `NEXT_PUBLIC_CONTACT_EMAIL`).
* In Brevo, your sender address is verified.
* You have **three receiving mailboxes you control**: Gmail, Proton Mail and Outlook/Hotmail (create throwaway ones if needed; free).
  Use a private browser window for each test so cookies do not interfere.

## The test (repeat for each of the three mailboxes)

1. Open `https://vinilium.vercel.app/en/sign-up`, create an account with that mailbox's address. Note the clock time.
2. Wait up to 5 minutes. Look in the **Inbox**, then **Spam / Junk**, then (Gmail) **Promotions / Updates**, (Outlook) **Other** / **Junk**.
3. Fill in the table below. Then open the message and note:
   * the **From** address and name actually shown (is it `brevosend.com`? your free-mail address? the project name?);
   * whether the **link** opens and verifies the account;
   * whether the mail client shows a warning ("this message may be dangerous", "unverified sender", missing images);
   * what **Reply** does: the new message should be addressed to your `NEXT_PUBLIC_CONTACT_EMAIL`, not to the From address.
4. Verify the account, then sign out and use **Forgot password** with the same address. Repeat steps 2 and 3 for the reset email, and
   check the new password works.
5. In Brevo (Transactional > Logs), find the two messages and note their status (delivered / soft bounce / blocked).

## Record the results

| Mailbox | Verification: where it landed | Time to arrive | From shown | Reset: where it landed | Reply goes to | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Gmail | inbox / spam / promotions / missing | | | | | |
| Proton | | | | | | |
| Outlook / Hotmail | | | | | | |

## How to read the result

* **All three in the inbox, links work:** email + password is workable for a small, invited group. Keep an eye on spam reports.
* **Some in spam, but arrive and links work:** workable only if you tell people to check spam (the pages already do); consider
  **invite-only** sign-up (`AUTH_SIGNUP_ALLOWLIST`) so you can warn each person.
* **Any mailbox never receives it, or mail is blocked:** do not launch email + password to the public. Options, in order of effort:
  1. **Google sign-in only**: set `AUTH_EMAIL_PASSWORD_ENABLED=false` (Vercel variable, then Redeploy). No email is sent at all.
  2. **Invite-only** with a short allowlist of people you have told in advance.
  3. **Buy a cheap domain later**, verify it with Brevo (or Resend) so DKIM/SPF/DMARC can be set properly. Then: set
     `EMAIL_FROM` to an address on that domain, keep `NEXT_PUBLIC_CONTACT_EMAIL`, and (if you use Resend) set `EMAIL_PROVIDER=resend`
     and `RESEND_API_KEY`. No code change is needed.

## What to send back to me

For each mailbox: inbox or spam, time to arrive, the From address shown, and whether the Reply address was your contact address. Do
not paste any link from the emails (they are credentials) and do not paste keys.

## What reduces the chance of landing in spam without a domain

None of this makes a message authenticated (that needs SPF, DKIM and DMARC on a domain you own: ADR 0004), and **nothing here has been measured
with real mailboxes**; the hand test above is the only evidence. These are the things the app already does or you can do:

* **A plain-text part with every email**, next to the HTML (the Brevo call sends `textContent`; `tests/unit/email-providers.test.ts` checks it
  carries the link). Messages with only HTML score worse with most filters.
* **Short, neutral subjects** and no spammy words, no capital letters, no exclamation marks, no emoji (today: "Verify your email for {appName}" and "Reset your {appName} password", in `email.verify.subject` and
  `email.reset.subject` in `src/messages/*.json`; keep them like that when editing).
* **One link per message** (the verification or reset link), no tracking pixels, no images, no link shorteners; the link points at the site's own
  address.
* **A real `Reply-To`** (`NEXT_PUBLIC_CONTACT_EMAIL`): a sender whose replies work looks less like a bulk sender.
* **A stable sender name** (`EMAIL_FROM_NAME`) and address; do not change them often.
* **Low, steady volume**: the free plan's 300 a day is also a reputation limit; a burst of sign-ups from one address range looks like abuse
  (`AUTH_SIGNUP_ALLOWLIST` and the per-IP limits are the brake).
* **Tell people** (the app does, on every screen that sends an email): check the spam folder and mark the message "not spam" or add the sender to
  contacts; one such action trains that person's filter.
* **Do not send test mail to many addresses** from the production sender; use your own few mailboxes.
* Once a domain exists: authenticate it in Brevo (SPF, DKIM) and publish a DMARC record; then revisit `auth.emailNotArrived` and ADR 0004.
