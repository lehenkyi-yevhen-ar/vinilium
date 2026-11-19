# Architecture decision records

Short records of the decisions that shape the project: what was decided, why, and what it costs. A record is not edited when the decision
changes; a new one supersedes it.

| # | Decision | Status |
| --- | --- | --- |
| [0001](0001-two-databases.md) | Two databases: dev and production, no fallback | accepted |
| [0002](0002-postgres-rate-limiting.md) | Rate limits and the Discogs budget live in Postgres | accepted |
| [0003](0003-no-stored-discogs-content.md) | No stored Discogs content: a TTL cache, a proxy, lists of ids | accepted |
| [0004](0004-brevo-free-mail-sender.md) | Email through Brevo with a free-mail sender | accepted, with a known cost |
| [0005](0005-csp-rollout.md) | A nonce-based Content-Security-Policy, report-only first | accepted, enforcement behind a switch |

See also [../architecture.md](../architecture.md) for the picture.
