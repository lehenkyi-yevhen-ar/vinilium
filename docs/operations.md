# Operations runbook

Short, practical, and written for one operator. **Never paste a secret into a chat, an issue or a commit.** Commands that touch the
production database are run by you, in a shell you close afterwards; always read the target the guard prints before confirming.

Related: [README](../README.md) (setup, environment variables), [Discogs compliance](discogs-compliance.md),
[legal review checklist](legal-review-checklist.md).

## 1. Where things live

| What | Where |
| --- | --- |
| Website and server code | Vercel project (Production environment holds the real variables) |
| Database | Neon: the **production** branch is used by the deployed site only; the **dev** branch by your machine and CI |
| Email (verification, password reset) | Resend (needs a verified sending domain) |
| Google sign-in | Google Cloud console > Google Auth Platform |
| Record data | Discogs API (key + secret in Vercel); the service is not affiliated with Discogs |

## 2. Vercel logs: where and what to look for

Vercel dashboard > your project > **Logs** (runtime logs). Set the time range, and filter by text or status. Useful searches:

| Search for | Meaning | What to do |
| --- | --- | --- |
| `[email]` and `failed` | A verification or reset email was not sent (`RESEND_API_KEY` missing, domain not verified, Resend refused) | Check the key in Vercel and the domain status in Resend; people cannot finish sign-up until fixed |
| `Invalid environment variables` | A required variable is missing or malformed (the message names it, never its value) | Fix it in Vercel > Settings > Environment Variables, then redeploy |
| `DatabaseConfigError` / `DATABASE_URL is not set` | The database target is wrong | Check `DATABASE_URL` for the Production environment |
| `[csp-report]` | The report-only Content-Security-Policy saw something it would block | See section 10; a handful from browser extensions is normal |
| status `429` on `/api/discogs/*` | Discogs or our own limits are throttling | See section 5 |
| status `401` on `/api/cron/purge` | `CRON_SECRET` is missing or wrong | Set it in Vercel (Cron sends it automatically) and redeploy |
| status `5xx` | A real error | Open the entry; the stack trace names the file |

Logs hold IP addresses and request paths: treat them as personal data (see the privacy policy).

## 3. Rotating secrets

Rotating means: create the new value, put it in Vercel (Production), **redeploy**, then revoke the old one. Do the revoke last so there
is no gap.

| Secret | How | Effect |
| --- | --- | --- |
| `BETTER_AUTH_SECRET` | New random value (`openssl rand -base64 32`) | **Everyone is signed out** (sessions no longer verify); no data is lost |
| `GOOGLE_CLIENT_SECRET` | Google Cloud > Credentials > your OAuth client > add a new secret, put it in Vercel, redeploy, then delete the old secret | None for users |
| `RESEND_API_KEY` | Resend > API Keys > create a new key, update Vercel, redeploy, delete the old key | None; emails resume |
| `DISCOGS_CONSUMER_KEY` / `_SECRET` | Discogs > Settings > Developers > your application | Until updated, record details show the "not set up" or error states |
| `CRON_SECRET` | New random value of 16+ characters in Vercel, redeploy | Vercel Cron picks it up automatically |
| `DATABASE_URL` | Neon > Roles > reset the password of the role, copy the new **pooled** connection string into Vercel, redeploy | Brief errors until the redeploy finishes |

If a secret may have leaked (committed, pasted, logged): rotate it at once, then check the provider's activity log.

## 4. Helping someone who cannot sign in

1. Normal path: **Forgot password** sends a reset link (valid 1 hour). If it does not arrive, check the Resend dashboard (delivered /
   bounced) and section 2.
2. Their email address is unverified: signing in re-sends the verification email.
3. There is no admin screen and no way for you to set someone's password. Last resort, after you have satisfied yourself about who is
   asking: let them export what they can, then delete the account row so they can sign up again (their lists go with it). Run in the
   Neon SQL editor **on the production branch, saying out loud which branch it is**:

   ```sql
   -- read first: confirm it is the right person
   select id, email, created_at from "user" where email = '<their email>';
   -- then, only if you really mean it (sessions, accounts and lists are deleted by the foreign keys):
   delete from "user" where email = '<their email>';
   ```

## 5. When Discogs throttles

What people see: the "Waiting for Discogs" state with a countdown (never an error page); the screen retries twice by itself and then
offers a button. Causes: the shared limit (about 60 requests a minute for the whole app) is used up, or one person hit their own cold
allowance (`RL_COLD_USER_PER_MIN`, default 24 a minute).

Look (read-only, Neon SQL editor):

```sql
select id, tokens, capacity, blocked_until, observed_limit, observed_remaining from discogs_bucket;
```

* `blocked_until` in the future: Discogs sent a 429 recently and every instance is waiting.
* Often throttled with few users: raise `DISCOGS_CACHE_TTL_SECONDS` toward its 6 h cap (the Discogs Terms forbid more), or lower
  `RL_COLD_USER_PER_MIN`.
* Persistently throttled: ask Discogs about a higher limit; do not work around it.

## 6. If Discogs revokes or changes access

Symptoms: record details show "Details not loaded" or "Waiting", searches fail with a clear message, `/api/discogs/*` answers 502/503.

* **Still works:** accounts, sign-in, lists, notes, condition, move, remove, export (lists store only release IDs and your own fields).
* **Does not:** search and record details.
* Check email from Discogs and the current API Terms of Use first. Do not scrape or use another route to get the data.
* To switch record details off tidily, remove the Discogs variables in Vercel and redeploy: the screens then say record details are not
  set up, instead of failing.
* Tell users plainly (a note on the home page) and keep the export available.

## 7. Database backups

You run these; I never touch production.

Check **how many days of history your Neon plan keeps** (Neon console > Project > Settings > Storage / restore window). That window is
your safety net for "I deleted the wrong thing"; the dump below is your own copy outside Neon.

```powershell
# PowerShell. Use the DIRECT (non-pooled) connection string of the PRODUCTION branch for pg_dump.
$env:DATABASE_URL = "<production connection string>"
pg_dump --format=custom --no-owner --file "vinilium-$(Get-Date -Format yyyy-MM-dd).dump" $env:DATABASE_URL
Remove-Item Env:DATABASE_URL
```

* A dump contains personal data: store it encrypted, off the repository, and delete old ones (the privacy policy must say how long
  backups are kept: see the legal checklist).
* Test a restore only into a **new Neon branch** (`pg_restore --no-owner --dbname <new branch string> file.dump`), never into production.

## 8. Scheduled purge

`vercel.json` runs `/api/cron/purge` once a day (valid on Hobby and Pro). Expired Discogs cache rows are never served, and every cache
write also deletes expired rows, so the cron is a backstop. On the Pro plan you can make it hourly (`"0 * * * *"`).
Manual run: `curl -H "Authorization: Bearer <CRON_SECRET>" https://<domain>/api/cron/purge`.

## 9. Cleaning old Google tokens (one time, after the deploy that stops storing them)

Since this release the app stores **no** Google OAuth tokens. Rows created earlier may still hold some. After deploying, in the Neon SQL
editor **on the production branch**:

```sql
select count(*) from account where provider_id = 'google' and (access_token is not null or refresh_token is not null or id_token is not null);
update account set access_token = null, refresh_token = null, id_token = null,
                   access_token_expires_at = null, refresh_token_expires_at = null
 where provider_id = 'google';
```

## 10. Security headers and CSP

* Always on: `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`.
* **CSP is report-only** (`Content-Security-Policy-Report-Only`): it blocks nothing; browsers send violations to `/api/csp-report`,
  which writes `[csp-report]` lines to the Vercel logs. Watch the logs for a few weeks. Real findings come from the site's own
  pages; one-off reports from browser extensions are noise. The policy still allows inline scripts and styles (Next.js and the design
  system need them). The next step is an enforcing, nonce-based policy once the reports are clean.
* **HSTS is off until you set `HSTS_MAX_AGE_SECONDS`.** Only do that after you have confirmed the whole site works over HTTPS
  (every page, sign-in, the Google redirect and email links). Roll out in steps: `300`, then `86400`, then `31536000`. Add
  `HSTS_INCLUDE_SUBDOMAINS=1` only if every subdomain is HTTPS too. A browser remembers HSTS for the full period, so do not jump to a
  year first.

## 11. Accessibility checks

Automated (every e2e run): axe on the main screens in the light and dark themes (desktop) and on a phone viewport, and scripted
keyboard checks (skip link, focus indicators, dialogs, pager, forms). A scan cannot judge wording, order or screen-reader behaviour,
so before launch and after big UI changes also do, by hand:

* Unplug the mouse: reach and operate every control on Home, Sign in, Search (3 steps), Release, Lists, Account. Is the order sensible?
* Zoom the browser to 200% and 400% (320 px wide): nothing is cut off or needs sideways scrolling.
* Screen reader smoke test (NVDA on Windows, VoiceOver on iOS): the lists page announces results, errors and "Removed from your lists".
* Turn on high-contrast / forced-colours mode and reduced motion.
* Read the uk and nb pages with a native speaker (see section 12): wording is part of accessibility.

## 12. Native-speaker review of the interface text

```bash
npm run i18n:export                 # writes docs/i18n/review-uk-nb.csv (UTF-8 with BOM; opens in Excel)
npm run i18n:import -- edited.csv   # DRY RUN: reports what would change, or what is wrong
npm run i18n:import -- edited.csv --write
npm test                            # the messages tests re-check keys and placeholders
```

Columns: `key, context, English source, uk, nb, placeholders`. Reviewers edit only the `uk` and `nb` columns. The import **refuses the
whole file** if any row changes a placeholder (`{count}`, plural forms), empties a string, edits the Discogs-prescribed footer wording,
removes a `[NEEDS LEGAL REVIEW]` mark, or if the English source changed since the export. The privacy and terms text is in the same
file but also needs a lawyer: language review does not replace that.

## 13. Legal pages before launch

`npm run legal:checklist` regenerates [legal-review-checklist.md](legal-review-checklist.md). `npm run legal:checklist -- --check`
fails while any `[NEEDS LEGAL REVIEW]` mark remains: run it before launch. Also set `NEXT_PUBLIC_OPERATOR_NAME`,
`NEXT_PUBLIC_OPERATOR_COUNTRY` and `NEXT_PUBLIC_CONTACT_EMAIL`, and change the "Draft of ..." date lines.

**If analytics, advertising or any new tracking is ever added:** the privacy policy, the cookie wording and (where required) a consent
notice must be revisited first, and the new tool added to the list of providers. Today the policy says there is none.

## 14. Deleting a user at their request

They can do it themselves in Account (immediate). On request by email, ask them to do that, or use the SQL in section 4. Remember
that backups age out on their own (state the period in the privacy policy).
