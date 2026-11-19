# Data inventory

Every table and column in the database (`src/server/db/schema.ts`), whether it is personal data, why it exists, how long it is kept, and where
it is deleted. **A test (`tests/unit/data-inventory.test.ts`) fails when a column is added to the schema and not listed here.** The privacy
policy (`legal.privacy.*` in `src/messages/*.json`) must describe what is in this file; `docs/data-inventory.md` is the source, the policy follows.

Columns in the table below are written as `table.column`. "Personal" means data about an identifiable person (GDPR meaning, including an IP
address and an email address). "Discogs content" means data that came from Discogs and is therefore bound by its Terms.

**Retention at a glance.** Account data is kept until the person deletes the account (immediately, from the Account page) or asks the operator to.
Sessions end on their expiry date and are purged. Verification rows are single-use and are purged when expired. Rate-limit counters are
purged when their window is long past. The Discogs cache is purged when it expires (4 h by default, 6 h at most). Backups at Neon age out on
Neon's schedule (the privacy policy states the period: [NEEDS LEGAL REVIEW]).

**Deletion paths.** (a) *Account deletion*: `delete from "user"` cascades `session`, `account` and `user_items` by foreign key. (b) *The purge*
(`GET /api/cron/purge`, daily): expired `discogs_cache`, `verification` and `session` rows and old `rate_limit` counters. (c) *The operator's
SQL* for a person's verification rows after a deletion request is in `docs/operations.md`, section 14.

## Tables and columns

### `user`: the account

| Column | Personal? | Why it exists | Retention | Deleted by |
| --- | --- | --- | --- | --- |
| `user.id` | pseudonymous key | Primary key; every other table points to it | with the account | (a) |
| `user.name` | **yes** | Shown in the header and on the Account page; from the sign-up form or the Google profile | with the account | (a) |
| `user.email` | **yes** | Sign-in, verification and reset emails; unique | with the account | (a) |
| `user.email_verified` | no (status of the email) | A verified address is required before sign-in | with the account | (a) |
| `user.image` | **yes** (a URL, usually a Google avatar) | Part of the Google profile Better Auth stores; the app does not display it | with the account | (a) |
| `user.locale` | **yes** (a preference) | The person's interface language, so emails and pages use it | with the account | (a) |
| `user.created_at` | **yes** (a date tied to a person) | Housekeeping | with the account | (a) |
| `user.updated_at` | **yes** (a date tied to a person) | Housekeeping | with the account | (a) |

### `session`: signed-in devices

| Column | Personal? | Why it exists | Retention | Deleted by |
| --- | --- | --- | --- | --- |
| `session.id` | pseudonymous | Primary key | until expiry or sign-out | (a), (b), sign-out |
| `session.expires_at` | no | When the session stops working | until purge | (a), (b) |
| `session.token` | **yes** (a credential) | The value in the session cookie; whoever holds it is signed in | until expiry or sign-out | (a), (b), sign-out |
| `session.created_at`, `session.updated_at` | **yes** (tied to a person) | Housekeeping | until purge | (a), (b) |
| `session.ip_address` | **yes** | Recorded by Better Auth at sign-in; the app does not use it | until purge | (a), (b) |
| `session.user_agent` | **yes** (a device fingerprint) | Recorded by Better Auth at sign-in; the app does not use it | until purge | (a), (b) |
| `session.user_id` | pseudonymous | Foreign key to `user` | until purge | (a), (b) |

### `account`: how the person signs in

| Column | Personal? | Why it exists | Retention | Deleted by |
| --- | --- | --- | --- | --- |
| `account.id` | pseudonymous | Primary key | with the account | (a) |
| `account.account_id` | **yes** (Google's id for the person, or the user id) | Links the sign-in method to the user | with the account | (a) |
| `account.provider_id` | no | `credential` (email + password) or `google` | with the account | (a) |
| `account.user_id` | pseudonymous | Foreign key to `user` | with the account | (a) |
| `account.access_token`, `account.refresh_token`, `account.id_token`, `account.access_token_expires_at`, `account.refresh_token_expires_at` | **yes if present** | Google OAuth tokens. **Never stored**: a database hook nulls them on every write (`src/server/auth/oauth-tokens.ts`) | none | (a); the one-time clean-up of old rows is in `docs/operations.md`, section 9 |
| `account.scope` | no | The OAuth scopes granted (basic profile) | with the account | (a) |
| `account.password` | **yes** (a salted scrypt hash, never the password) | Email + password sign-in | with the account | (a) |
| `account.created_at`, `account.updated_at` | **yes** (tied to a person) | Housekeeping | with the account | (a) |

### `verification`: single-use links

| Column | Personal? | Why it exists | Retention | Deleted by |
| --- | --- | --- | --- | --- |
| `verification.id` | no | Primary key | until expiry | (b) |
| `verification.identifier` | **may be** (Better Auth stores the email address or a token name here) | Which email or flow the link belongs to | until expiry (1 hour for a reset, longer for a verification) | (b); not linked to `user` by a key |
| `verification.value` | **yes** (a credential: the one-time token) | The link's secret | until expiry | (b) |
| `verification.expires_at` | no | When the link stops working | until purge | (b) |
| `verification.created_at`, `verification.updated_at` | no | Housekeeping | until purge | (b) |

### `user_items`: the person's Wishlist and Collection

| Column | Personal? | Why it exists | Retention | Deleted by |
| --- | --- | --- | --- | --- |
| `user_items.id` | no | Primary key | with the account | (a) |
| `user_items.user_id` | pseudonymous | Foreign key to `user` | with the account | (a) |
| `user_items.discogs_release_id` | **yes in combination** (a person's taste) | Which pressing. A Discogs id only: **no Discogs content is stored** | with the account | (a) |
| `user_items.list` | **yes in combination** | `wishlist` or `collection` | with the account | (a) |
| `user_items.notes` | **yes** (free text the person wrote) | The person's own notes | with the account | (a) |
| `user_items.condition_media`, `user_items.condition_sleeve` | **yes in combination** | Goldmine grades the person entered (Collection only) | with the account | (a) |
| `user_items.added_at`, `user_items.updated_at` | **yes in combination** | Sorting by date added | with the account | (a) |

### `rate_limit`: abuse counters

| Column | Personal? | Why it exists | Retention | Deleted by |
| --- | --- | --- | --- | --- |
| `rate_limit.id` | **may be** (equals the key) | Primary key | until purge | (b) |
| `rate_limit.key` | **yes** (contains an IP address or a user id, e.g. `app:search:ip:<ip>`, `cold:user:<id>`, `<ip>/sign-in/email`) | Which address or person a counter belongs to | counters older than a day are purged | (b); (a) does not remove them, they are not linked by a key |
| `rate_limit.count` | no | Requests in the window | until purge | (b) |
| `rate_limit.last_request` | no | Window start (a number) | until purge | (b) |

### `discogs_cache`: Discogs answers (Discogs content)

| Column | Personal? | Why it exists | Retention | Deleted by |
| --- | --- | --- | --- | --- |
| `discogs_cache.key` | no | Cache key built from the query (it can contain a search phrase a person typed; it is not tied to a person) | until `expires_at` | (b), and on every cache write |
| `discogs_cache.payload` | no, but **Discogs content** | Our normalised, whitelisted copy of an answer. TTL-bound: never served or kept past `expires_at` (default 4 h, hard cap 6 h) | until `expires_at` | (b), and on every cache write |
| `discogs_cache.fetched_at`, `discogs_cache.expires_at` | no | The freshness rule of the Discogs Terms | until purge | (b) |

### `discogs_bucket`: the shared request budget

| Column | Personal? | Why it exists | Retention | Deleted by |
| --- | --- | --- | --- | --- |
| `discogs_bucket.id` | no | One row per API origin | permanent (one or two rows) | n/a |
| `discogs_bucket.tokens`, `discogs_bucket.capacity`, `discogs_bucket.refill_per_sec`, `discogs_bucket.updated_at`, `discogs_bucket.blocked_until`, `discogs_bucket.observed_limit`, `discogs_bucket.observed_remaining`, `discogs_bucket.observed_at` | no | The token bucket and what Discogs reported about its limit | permanent | n/a |

## What is not in the database

* **Cookies** (set by the app): the session cookie (`better-auth.session_token`, with the `__Secure-` prefix over https) and the language
  cookie `NEXT_LOCALE`. Both are strictly necessary.
* **Browser storage** (never sent to us): `vinilium:theme` (`dark` | `light` | `system`) and `vinilium:search-help` (`closed`).
* **Logs** (Vercel): request paths, status codes and IP addresses, kept by Vercel; the app adds only the lines described in
  `tests/unit/log-hygiene.test.ts`.
* **Processors**: Neon (database), Vercel (hosting and logs), Brevo (sends verification and reset emails; receives the address, the name and
  the link), Google (sign-in; receives the browser's visit to Google, sends back the basic profile), Discogs (receives our server's requests,
  never a person's identity or IP address).
