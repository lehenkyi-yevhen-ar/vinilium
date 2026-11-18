# 0002. Rate limits and the Discogs budget live in Postgres

**Status:** accepted.

## Context

The app runs as serverless functions on Vercel: many short-lived instances, no shared memory. Discogs allows about 60 requests a minute for
the whole application, and the Terms require us to respect it. Our own abuse limits (per IP, per person, auth endpoints) must also hold
across instances. A Redis or KV store would be one more service, one more secret and, on Vercel, one more vendor.

## Decision

* One Postgres table, `rate_limit`, holds our own fixed-window counters (one atomic upsert per hit), including Better Auth's.
* One Postgres table, `discogs_bucket`, holds the **token bucket** for outbound Discogs calls, one row per API origin, taken under a row
  lock so concurrent instances draw from the same budget. Capacity and refill follow the limit Discogs reports in its
  `X-Discogs-Ratelimit*` headers; a 429 sets `blocked_until` for everyone.
* Layers, cheapest first: cache (free) → per-IP flood ceiling and cold allowance → per-user ceiling → per-person cold-fetch cap → the bucket.
  A refused request never reaches Discogs and answers a typed 429 with `Retry-After`, which the UI shows as a countdown.
* Retries are bounded (3), use exponential backoff with full jitter, and give up with `throttled` instead of waiting long.

## Consequences

* No extra service. The cost is a few small Postgres writes per request, acceptable at this scale.
* The limiter is only as accurate as one Postgres round trip; a burst can overshoot by the number of in-flight requests, which the bucket's
  row lock and the conservative 25-token default before the first response keep small.
* The split of the per-IP limit (cold allowance versus flood ceiling) is explained in `docs/operations.md` section 17.
* If traffic ever outgrows this, the table is the interface to replace.
