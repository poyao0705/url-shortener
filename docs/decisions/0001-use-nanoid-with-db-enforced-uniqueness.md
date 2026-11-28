# Use `nanoid` with database-enforced uniqueness for short codes

## Context and Problem Statement

`POST /shorten` needs to generate compact, unique short codes while allowing different users (`uid`) to shorten the same destination URL independently. The generation path must avoid single-point-of-failure bottlenecks and unnecessary database round-trips under concurrent requests.

## Considered Options

* Counter-backed sequential IDs using a dedicated cache or counter service
* Deterministic MD5 hash truncation of `longUrl`
* Random `nanoid` generation with bounded `Url_pkey` collision retries and database-enforced `(longUrl, uid)` uniqueness

## Decision Outcome

Chosen option: "Random `nanoid` generation with bounded `Url_pkey` collision retries and database-enforced `(longUrl, uid)` uniqueness", because it avoids coordinating a shared counter, prevents guaranteed cross-user hash collisions when multiple users shorten the same URL, and handles duplicates atomically in a single `INSERT` (starting at 8 characters and escalating `8 → 9 → 10` across up to 9 attempts via [url.service.ts](../../url-shorten-api/src/services/url.service.ts)).

### Consequences

* Good, because there is no counter service single point of failure or cross-instance counter coordination.
* Good, because different users can shorten the same `longUrl` independently while PostgreSQL's `Url_longUrl_uid_key` constraint enforces per-user uniqueness atomically without a redundant upfront `SELECT`.
* Good, because starting at 8 `nanoid` characters makes early short-code collisions negligible while bounded retries handle collisions cleanly.
* Bad, because short codes are non-deterministic and a severe collision burst can require up to 9 database insert attempts before failing with `500`.
* Bad, because `uid` is currently hardcoded to `"example"` until authentication/JWT extraction is implemented.
