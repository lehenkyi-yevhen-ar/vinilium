# Launch checklist (one list, for the owner)

Written for the person who does every merge, push and dashboard step. Plain language, in the order to do things. The detail lives in
the runbook ([operations.md](operations.md), section numbers below) and is linked, not repeated. **A click path marked "(unverified)" was
not checked in the dashboard** (they change; if a label differs, look for the nearest one). Never paste a secret into a chat, an issue or a file:
variable **names** only.

Dates are 2026-11-23 unless another date is written.

## Done and decided (not reopened)

| What | Decision or fact | Recorded |
| --- | --- | --- |
| Sign-in methods | **Email + password AND Google stay open for everyone**: no allowlist, no flag changes (decision 1, option A). | [decisions-needed.md](decisions-needed.md) section 0 |
| Mail going to spam | **Accepted.** The "nothing arrived? check your spam folder" notes stay. Brevo with a free-mail sender stays (ADR 0004). | same |
| Google "Testing mode" | A third account that was not on the test-users list could sign in. **Unexplained, accepted as is**: it works, and this is a free, non-commercial hobby app. Kept documented as an *unexplained, accepted observation*; do not rely on the test-users list as an access control. | same |
| DEV database branch | Holds copies of real users; the owner does not mind and **will not run `docs/ops/dev-cleanup.sql` now**. The file stays, with the risk note below. | same |
| Dependabot | Delegated to the agent, decided: [dependency-updates.md](dependency-updates.md). The only requirement was that nothing breaks. | same |
| Secret history (decision 6c) | The owner **already rotated `BETTER_AUTH_SECRET`** in Vercel. The Google client ID/secret and Discogs values in the first commit's `.env.example` were **fake placeholders, never used for real**. All 11 findings are listed one by one in `.gitleaksignore`. **One open point:** the line for the Resend-shaped value in the same file (line 25) was not named in that statement; the project never sent mail through Resend, but confirm it (if it was ever real, revoke it in Resend). | same, and `.gitleaksignore` |
| **Verified by the owner** (not by the agent) | **Safari works.** **A real phone works.** **The design system Lis is the owner's own project** (the licence decision remains theirs, see "Later"). **The KyivType Sans credit is placed correctly.** | this file |

**DEV data risk (one line, kept on purpose):** anything that can read the DEV branch (your machine, a CI job given its address) can read copies of real
people's names and emails. Keep `DEV_DATABASE_URL` out of CI and chats; running `docs/ops/dev-cleanup.sql` on the DEV branch (confirm the branch id
first) removes the copies whenever you change your mind. Nothing in the tests reads or changes anyone else's rows.

---

## Part 1. Before inviting anyone

Do these in order. Each has what it is for, the steps, how to check, and what to do if it fails.

### 1. Merge, deploy, and run the smoke test
* **Why:** the legal-text, Discogs and dependency changes only help once they are live.
* **Steps:** merge the pull requests in the order given in the last report (`docs/launch-readiness` first, then `chore/deps`); wait for the Vercel production
  deployment to finish (Vercel > the project > Deployments; click path unverified). Then, from the repository folder:
  ```bash
  # ===== PRODUCTION SMOKE TEST (anonymous, read-only; at most 10 POSTs to the sign-in endpoint with a fake address) =====
  npx tsx scripts/smoke-prod.ts
  ```
  What it checks, and why it is safe: the header of `scripts/smoke-prod.ts`. It creates no account and sends no email.
* **Verify:** the last line says `RESULT: OK`. `INFO` lines (CSP mode, HSTS) are facts, not failures.
* **If it fails:** the failing line names the check. A 5xx or a missing page: Vercel > Logs (operations.md, section 2); if the deploy is the cause, roll back
  (section 20h). A `[... TO BE FILLED]` text on a legal page: step 2.

### 2. Variables in Vercel (Production), by name
* **Why:** unset values show visible placeholders on the legal pages and weaken the Discogs `User-Agent`.
* **Steps:** Vercel > the project > Settings > Environment Variables (unverified path). Check these exist for **Production**: `NEXT_PUBLIC_OPERATOR_NAME`,
  `NEXT_PUBLIC_OPERATOR_COUNTRY`, `NEXT_PUBLIC_CONTACT_EMAIL`, `APP_CONTACT` (= `https://vinilium.vercel.app/en/contact`), `NEXT_PUBLIC_APP_URL` and
  `BETTER_AUTH_URL` (= `https://vinilium.vercel.app`), `CRON_SECRET`, the Discogs key and secret, `BREVO_API_KEY`, `EMAIL_FROM`, `EMAIL_FROM_NAME`,
  `EMAIL_PROVIDER` = `brevo`. After any change: **Redeploy** (a variable reaches only new deployments).
* **Verify:** open `https://vinilium.vercel.app/en/privacy` and `/en/contact`: no text in square brackets that says "TO BE FILLED"; the smoke test also fails on it.
* **If it fails:** the missing name is the one in the placeholder; set it and redeploy. (`APP_CONTACT` is optional now: unset or still the placeholder, the Discogs
  `User-Agent` uses this site's contact page.)

### 3. Discogs: the registered name, the account email, the credentials
* **Why:** Discogs can change terms "via account email or otherwise" and can block an application whose name or `User-Agent` it dislikes.
* **Steps:** at Discogs (Settings > Developers; unverified path) check that the application is registered as exactly **Vinilium** (the Application Name policy was
  compared with the app on 2026-11-23: no conflict, [discogs-compliance.md](discogs-compliance.md) row 13). Make sure the Discogs account email is one you read.
* **Verify:** sign in on the site and run one search; results appear (a cold search; nothing else is needed).
* **If it fails:** operations.md, sections 5, 6 and 20c.

### 4. The daily purge has run once, and an uptime monitor watches `/api/health`
* **Why:** retention (what the privacy text promises) is done by the daily purge; the monitor tells you the site is down before a person does.
* **Steps:** the purge: operations.md, section 19 (`?dryRun=1` shows what it would delete without deleting). The monitor: section 20b (free, no code).
* **Verify:** the dry run answers `{"ok":true,...}`; the monitor shows "up".
* **If it fails:** a 401 from the purge means `CRON_SECRET` is missing or different in Vercel (section 3 / 20g).

### 5. Know your database backups
* **Why:** it is your only undo for "I deleted the wrong thing".
* **Steps:** read operations.md section 20f. Find out which Neon plan the project is on and what history window it has (Free = up to 6 hours per Neon's plans page; unverified for
  your project). Take one dump with the clipboard procedure and delete it again after a few days.
* **Verify:** a dump file of non-zero size exists; you know where it is and when you will delete it.
* **If it fails:** `pg_dump` older than the server: install a newer client (the Neon console shows the Postgres version).

### 6. The legal pages say what they should
* **Why:** the privacy text and the terms are what a stranger reads before trusting the site. They are written by the operator **without professional legal advice** and
  carry a notice saying so; they are accurate against the code (see [legal-accuracy-review.md](legal-accuracy-review.md)), which is not the same as a lawyer's review.
* **Steps:** read the privacy page and the terms once in English (and the Ukrainian version if that is your language), looking for any sentence about you that is not true.
  The review lists what it could and could not verify, and the passages that still carry `[NEEDS LEGAL REVIEW]` (`npm run legal:checklist`).
* **Promises the text makes that only you can keep** (change the text if you will not): you delete a private database copy soon after you made it (operations.md, section 20f); you tell signed-in users by email or a notice on the site before a change that matters;
  you answer a data request within one month; the project is on Vercel's free Hobby plan (the text says logs are kept 1 hour there: if the plan changes, the sentence changes); mail goes through Brevo (not Resend). Six passages still ask an open question and are marked
  (a nickname as identity; cookies and local storage; the minimum age; liability; governing law): none blocks the launch, all are listed with the reasons in [legal-accuracy-review.md](legal-accuracy-review.md), which also lists the residual risks in plain language.
* **Verify:** every statement about what is stored, for how long, and who is involved matches what you know.
* **If it fails:** a wrong sentence is fixed in `src/messages/*.json` (`legal.*`), all three languages, then the CSV in section "Later" is regenerated.

### 7. Email by hand
* **Why:** the one thing no test can prove is that a real mailbox receives the mail.
* **Steps:** [email-deliverability-test.md](email-deliverability-test.md) with real mailboxes, in the three languages. Brevo's authorised-IP list must be **off** (operations.md, section 15).
* **Verify:** the mail arrives (spam folder is accepted); the link works.
* **If it fails:** operations.md, section 15, `[email]` lines in the Vercel logs.

---

## Part 2. First week

* **Every day, two minutes:** operations.md section 20a (health, `[email]`, `[csp-report]`, `[metrics]`, 5xx). After each deploy run the smoke test again.
* **Watch `[csp-report]` for about a week**, then decide the **CSP enforce rollout**:
  * *Why:* report-only blocks nothing; enforcing protects against injected scripts. *Trade-off:* it also blocks scripts that some browser extensions inject.
  * *Steps:* operations.md section 10 (the whole e2e suite was already run with `CSP_MODE=enforce`). In Vercel add `CSP_MODE` = `enforce` (Production), **Redeploy**, click through sign-in
    (email and Google), search, a release card, the lists, the account page, the language and theme menus. Then `npx tsx scripts/smoke-prod.ts --expect-csp enforce`.
  * *Rollback:* delete `CSP_MODE` (or set `report-only`), **Redeploy**: the next page load is no longer blocked.
  * *If it fails:* a page that works in a private window but not in your normal window is an extension; one that fails everywhere is a real finding, so roll back and read `[csp-report]`.
* **Check the Brevo numbers** (Brevo > Transactional > Statistics; unverified path) a few times: delivered, bounced, spam reports, and how close you are to 300 a day (section 20d).
* **Discogs:** read any mail from Discogs the same day; if throttling shows (`[metrics]` `throttled` above 0 for long), section 5.
* **GitHub:** turn on branch protection for `main` and Dependabot alerts (Settings > Branches / Code security; unverified paths). First look at the dependency pull requests as
  described in [dependency-updates.md](dependency-updates.md).
* **Native-speaker review of Ukrainian and Norwegian** (the new legal wording in uk and nb is also AI-written):
  ```bash
  npm run i18n:export                 # writes docs/i18n/review-uk-nb.csv (opens in Excel)
  npm run i18n:import -- edited.csv   # a DRY RUN: says what would change, or what is wrong
  npm run i18n:import -- edited.csv --write
  npm test
  ```
  Reviewers edit only the `uk` and `nb` columns. The importer **refuses the whole file** if a row changes a placeholder (`{count}`, plural forms), empties a string, edits the
  Discogs-prescribed footer wording, removes a `[NEEDS LEGAL REVIEW]` mark, or if the English source changed since the export (operations.md, section 12).

---

## Part 3. Later (optional or conditional)

| Item | Why it matters | What to do | Verify | If it fails |
| --- | --- | --- | --- | --- |
| **HSTS** | Makes browsers insist on HTTPS. A browser remembers it for the whole period, so it is hard to undo. | Not before HTTPS works on every page, the Google redirect and the email links. Without a custom domain, `includeSubDomains` is not an option and a wrong step cannot be undone for a host you do not control. If you still want it: `HSTS_MAX_AGE_SECONDS` = `300`, then `86400`, then `31536000` (operations.md, section 10). | `npx tsx scripts/smoke-prod.ts --expect-hsts` | Delete the variable and Redeploy; browsers that saw it keep it until the period ends (that is why the steps are small). |
| **Google "In production"** | In Testing mode Google normally restricts sign-in to the listed test users and shows an "unverified app" warning (as Google documents it; **not re-checked here**); publishing removes that. | Google Cloud console > Google Auth Platform > Audience > Publish app (unverified path). The consent screen asks for the privacy and terms URLs: `https://vinilium.vercel.app/en/privacy` and `/en/terms`. **Whether Google accepts a `vercel.app` address as an "authorized domain" is UNVERIFIED**; if it refuses, the options are a custom domain or staying in Testing mode (the observation under "Done and decided" applies either way). | Sign in with Google from a fresh account; no "unverified app" wall that blocks you. | Go back to Testing; nothing in the app changes. |
| **The optional email to Discogs** | A written answer to three questions the terms leave open (images, attribution, rate limits). | [discogs-contact-draft.md](discogs-contact-draft.md): fill the three placeholders and send it yourself, or use the Help Center. | Put any answer in `docs/discogs-compliance.md`. | Nothing breaks if you never send it. |
| **Repository visibility** | CodeQL and secret scanning are free on public repositories; on a private one they depend on the plan. Public code also has to be fine with the Discogs terms and with the Lis licence. | Decision 5b in [decisions-needed.md](decisions-needed.md). Read the Discogs terms and the Lis licence first; check Settings > Code security for what the plan includes (unverified path). | The CodeQL and secret-scan jobs on a pull request are green and upload results. | Switching back to private is one click, but anything already public was seen. |
| **The Lis licence** | The design system is your own project, so the licence under which it ships with this site is your decision. | Decide the licence (or none) and where to state it; if the repository goes public, put it where you decide and keep the credit wording you verified. The agent never edits `public/ds/`. | The licence text exists where you decided. | n/a (your decision). |
| **Real devices still untested** | You verified Safari and a real phone yourself. Firefox on desktop and a real Android phone are unverified (Firefox and WebKit only run signed-out smoke tests on a developer machine). | One pass on each when convenient (operations.md, section 11 lists the manual checks). | The pages in section 11 work with keyboard only and at 200% zoom. | Report the page and browser; a fix is a small commit. |
| **A custom domain** | `vercel.app` cannot carry HSTS safely, cannot be an `authorized domain` for Google (unverified), and mail sender reputation stays on a free-mail address. | Buy one, add it in Vercel, then update `NEXT_PUBLIC_APP_URL`, `BETTER_AUTH_URL`, `APP_CONTACT`, the Google redirect URIs and the legal text. | The smoke test with `--base https://<domain> --allow-other-host`. | Keep the `vercel.app` address as the primary until everything works. |
| **Two-factor / passkeys, sessions list** | Decisions 4 and 6 in [decisions-needed.md](decisions-needed.md). | Not scheduled. | n/a | n/a |

---

## Where the other lists went

This file replaces reading three lists in turn. They stay as background: [pre-launch-checklist.md](pre-launch-checklist.md) (the long form, with the "Verified" notes),
[decisions-needed.md](decisions-needed.md) (the decisions and their reasoning), [merge-checklist.md](merge-checklist.md) (the steps for the first big merge).
