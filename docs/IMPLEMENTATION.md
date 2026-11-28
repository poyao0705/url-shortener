# Implementation journey

This document records how the URL shortener evolved and which feature decisions reached the codebase. It covers the URL-shortener feature history from `1fffd3a` (25 October 2026) through `974f7cd` (28 November 2026), cross-checked against the route JSDoc, service implementation, message-queue pipeline, database contract, migrations, and tests. Dates follow the commits' Australia/Sydney timezone.

## 1. Prove the shorten-and-redirect flow

**25 October 2026 — `95149da`, `785f9a6`**

The first working version used Fastify and TypeScript, with URL mappings stored in a process-local `Map`. Short codes were six randomly selected alphanumeric characters. This established the API shape:

- `POST /shorten` accepts `{ "longUrl": "..." }` and returns `{ "respUrl": "..." }`.
- The returned URL uses the incoming request's protocol and host, followed by the generated code.
- `GET /:shortUrl` looks up the original URL and reports a missing mapping with `404`.

The initial lookup returned a placeholder success message. Commit `785f9a6` replaced that response with an actual redirect, completing the core user flow. The `Map` was explicitly a temporary substitute for a database: mappings disappeared with the process, and generation did not yet protect against code collisions.

## 2. Choose generated codes and define collision handling

**26 October 2026 — `784ed4a`, `ca43d11`; clarified in JSDoc on 27 October — `10b89f3`**

Code generation changed from random alphanumeric characters to the first six hexadecimal characters of an MD5 hash. Initially the hash input was the long URL itself; later persistence work added a retry suffix.

The [shortening route's JSDoc](../url-shorten-api/src/routes/root.ts) records the requirement to generate a unique short code and two approaches:

- **Counter-backed IDs:** a separate cache could allocate increasing IDs. The documented concern was a single point of failure; multiple cache instances would also require concurrency coordination. This remained an alternative.
- **Generated codes, selected:** generate candidates without a shared counter, handle collisions by retrying, and increase the code length after repeated failures. Random generation was explored in the prototype; hashing became the implemented generator.

Hash truncation does not itself guarantee uniqueness. The eventual implementation combines candidate generation with database uniqueness constraints and bounded retries, described below.

## 3. Establish persistent storage and service ownership

**26 October 2026 — `6aa44d5`, `554f42c`, `cbd1161`, `97855c2`, `5b04b82`, `52210b4`, `e48ee14`**

PostgreSQL 18 was added through Docker Compose, alongside the Prisma 8 prerelease contract-based PostgreSQL ORM. The repository committed the schema, generated JSON and TypeScript contracts, and migration history.

The URL data model introduced a short-code primary key, the original URL, a user identifier, a creation timestamp, and a usage counter. Commit `e48ee14` gave the counter a database default of zero so inserts could omit it. Long-URL uniqueness was added the following day.

URL generation moved out of the route into `UrlService`. Awilix provided an application-owned dependency container, with one database client and service per application instance. Shutdown disposal closes that instance's database connection. Routes also gained a service override for tests, allowing the HTTP flow to run against an injected implementation.

This stage established the persistence foundation and service boundary. The routes still stored mappings in the in-memory `Map`; database-backed registration and resolution arrived in `a100960` on 27 October.

Sources: [application wiring](../url-shorten-api/src/app.ts), [database factory](../url-shorten-api/src/prisma/db.ts), [schema](../url-shorten-api/src/prisma/contract.prisma), and [migrations](../url-shorten-api/migrations/app/).

## 4. Persist registrations and make failure behavior explicit

**27 October 2026 — `76e5890`, `573319a`, `f5f6fd8`, `a100960`, `f18c7af`, `069cc93`, `31b1662`**

### Validate requests at the route boundary

Zod replaced unchecked request casts. The shortening body must contain a string `longUrl`, and the redirect parameters must contain a string `shortUrl`. Validation failures are handled as `400` responses. This validates the request shape and types; the committed schemas do not check URL syntax, allowed protocols, or non-empty strings.

The hash helper became a standalone `generateShortUrl` function, leaving `UrlService` responsible for the registration and lookup workflows.

### Make PostgreSQL the source of truth

Commit `a100960` switched both routes from the `Map` to asynchronous service operations:

- `shortenUrl` checks for an existing long URL and inserts the new mapping before returning its short code.
- `resolveUrl` retrieves the stored original URL by short code.
- Successful registration still returns the full short URL; successful resolution redirects to the original destination.

Commit `f5f6fd8` added a unique constraint on `longUrl`. The resulting policy is one stored mapping per exact long-URL string. Registering that string again returns `409` with `URL already exists`; it does not return the earlier short URL. The unique constraint also enforces this policy when concurrent requests both pass the initial existence check.

### Separate duplicate URLs from code collisions

The persistence implementation introduced retries, and `069cc93` corrected their control flow and imposed a total attempt limit. Commit `31b1662` then distinguished PostgreSQL unique-constraint failures by constraint name:

| Insert outcome | Committed behavior |
| --- | --- |
| Duplicate long URL, `Url_longUrl_key` | Report `URL already exists` immediately; do not retry. |
| Duplicate short code, `Url_pkey` | Generate another candidate and retry. |
| Other constraint or database failure | Propagate the error without treating it as a collision. |

That generation sequence hashed `${longUrl}-${retry}` and took a hexadecimal prefix. It tried three candidates at each length: six characters, then seven, then eight. The suffix counter reset when the length increased. Nine failed insert attempts produce `Failed to shorten URL`, which the route exposes as a generic `500` response.

Error messages were centralized in [constants](../url-shorten-api/src/constants.ts). The resulting API behavior is:

| Request outcome | HTTP response |
| --- | --- |
| Successful shortening | `200` with `{ "respUrl": "<protocol>://<host>/<code>" }` |
| Successful resolution | `302` with the original URL in `Location` |
| Invalid shortening body or redirect parameters | `400` with `{ "error": "Invalid request body" }` |
| Long URL already registered | `409` with `{ "error": "URL already exists" }` |
| Short code not found | `404` with `{ "error": "URL not found" }` |
| Unexpected failure or exhausted collision attempts | `500` with `{ "error": "Internal server error" }` |

Subsequent cleanup and import fixes (`507c861`, `34acee1`) removed stale implementation comments and corrected module imports. Commit `10b89f3` rewrote the route JSDoc to describe the selected hashing approach and the scaling alternatives accurately.

Sources: [routes and JSDoc](../url-shorten-api/src/routes/root.ts) and [URL service](../url-shorten-api/src/services/url.service.ts).

## 5. Cache redirects and add operational logging

**28 October 2026 — `b3a644e`, `f17dc09`, `a44f09d`, `82c6e3b`**

The redirect JSDoc identifies high read traffic as a requirement and records database read replicas and Redis caching as scaling approaches. Redis caching reached the implementation; read replicas remained a design option.

Redis was first added to Docker Compose, followed by a client managed through the dependency container. The default application requires `REDIS_URL` and connects Redis before constructing its URL service. Shutdown disposal quits the client. An injected service bypasses creation and connection of the default database and Redis clients.

Commit `82c6e3b` implemented the redirect cache flow:

1. Look up the short code directly as the Redis key.
2. Return a non-empty cached string immediately, without querying PostgreSQL.
3. On a missing or empty cache entry, query PostgreSQL.
4. Cache a found mapping for one hour (`EX: 3600`), then return the destination.
5. Report an unknown code as missing without caching that result.

Registration writes to PostgreSQL and does not populate Redis. The first redirect fills the cache. A truthy non-string cache value is rejected as `Invalid cached URL`.

The committed cache path propagates Redis read and write failures. A failed cache read does not fall back to PostgreSQL, and a failed cache write prevents an otherwise successful database lookup from returning its destination. These failures become generic `500` responses at the route boundary.

Fastify's logger was injected into `UrlService` to record cache hits and misses, cache population, missing mappings, collisions, and errors. Routes log unexpected errors before returning a generic response; the Redis client also logs connection errors.

Local infrastructure gained environment-supplied database and Redis passwords, persistent volumes, and a PostgreSQL health check. Redis uses append-only persistence, a 256 MB memory limit, and `allkeys-lru` eviction. Both database and Redis ports are bound to localhost.

Sources: [cache and logging implementation](../url-shorten-api/src/services/url.service.ts), [client lifecycle](../url-shorten-api/src/app.ts), and [Compose configuration](../compose.yaml).

## 6. Record the behavior in tests

**26–28 October 2026 — especially `52210b4`, `31b1662`, `9055f2a`**

Tests evolved alongside the service extraction, persistence changes, collision fixes, and caching. The committed suite records these expectations:

- [Route tests](../url-shorten-api/test/routes/root.test.ts) cover shortening and redirecting through the default service, service injection, and concurrent registration of the same URL. The concurrent case expects one `200`, one `409`, and exactly one database row.
- [Service tests](../url-shorten-api/test/services/url.service.test.ts) cover duplicate-long-URL insert conflicts, retrying short-code collisions, the nine-attempt limit with lengths `6, 6, 6, 7, 7, 7, 8, 8, 8`, and propagation of unrelated errors.
- The same service tests cover cache hits, misses and empty entries, the one-hour expiry, reuse of populated entries, missing mappings, invalid cached values, and Redis/database failure propagation.
- [Database lifecycle tests](../url-shorten-api/test/plugins/database.test.ts) check that application instances own separate database clients and close only their own client, including when another application uses an injected service.

The final reviewed commit of this phase, `9055f2a`, expanded cache coverage and added the concurrent registration case.

## 7. Scope uniqueness per user, switch to `nanoid`, and streamline writes

**26–28 November 2026 — `08a99ac`, `458c9dd`, `dfc9d09`, `eb0108b`**

### Allow different users to shorten the same URL

Commit `08a99ac` replaced the global `@unique` constraint on `longUrl` with a composite unique constraint on `(longUrl, uid)`, pinned to the constraint name `Url_longUrl_uid_key` in the schema and migrations. Different users can now create independent short codes for the same destination URL, while a duplicate `(longUrl, uid)` pair still returns `409` with `URL already exists`.

`UrlService` updated its PostgreSQL unique-constraint check from `Url_longUrl_key` to `Url_longUrl_uid_key`. Commit `458c9dd` also scoped the pre-insert lookup by `uid` before that lookup was removed the next day.

### Replace MD5 hashing with `nanoid` and raise starting length

Because different users can now shorten the same `longUrl`, deterministic MD5 hashing of `longUrl` would collide across users on the first attempt. Commit `08a99ac` replaced MD5 prefix hashing in `generateShortUrl` with random `nanoid(length)` generation while keeping the bounded retry loop for `Url_pkey` collisions.

Commit `dfc9d09` raised the starting `SHORT_URL_LENGTH` from `6` to `8` characters to avoid early collisions as the table grows. With three retries per length and nine total attempts, code generation now tries lengths `8, 8, 8, 9, 9, 9, 10, 10, 10` before failing with `Failed to shorten URL`.

### Remove the redundant pre-insert `SELECT`

Commit `eb0108b` removed the upfront `Url.where({ longUrl, uid }).first()` query from `shortenUrl`. PostgreSQL's `Url_longUrl_uid_key` constraint already enforces duplicate detection atomically during `INSERT`:

| Insert outcome | Current behavior |
| --- | --- |
| New `(longUrl, uid)` | Succeeds in a single `INSERT` query (down from `SELECT` + `INSERT`). |
| Duplicate `(longUrl, uid)`, `Url_longUrl_uid_key` | Caught immediately and reported as `409` (`URL already exists`); no retry. |
| Duplicate short code, `Url_pkey` | Retries with a newly generated `nanoid`, escalating length `8 → 9 → 10`. |
| Other constraint or database failure | Logged and propagated as `500`. |

Sources: [URL service](../url-shorten-api/src/services/url.service.ts), [schema](../url-shorten-api/src/prisma/contract.prisma), and [migrations](../url-shorten-api/migrations/app/).

## 8. Add click-event storage, stricter URL validation, and the BullMQ pipeline

**28 November 2026 — `c15bda4`, `030b243`, `bc70547`, `fa32fd5`, `f7e4ceb`, `b443ffd`, `8bdb2ce`, `4c5e721`, `974f7cd`**

### Add the `ClickEvent` model and tighten URL validation

Commit `c15bda4` added the `ClickEvent` table and regenerated the Prisma 8 contracts and migration history. Each event records an auto-incrementing `id`, a `shortUrl` foreign key referencing `Url.shortUrl` (indexed for lookups), a `clickedAt` timestamp (`TimestamptzString` defaulting to `now()`), and an optional `referrer`.

Commit `030b243` tightened `POST /shorten` request validation in [routes](../url-shorten-api/src/routes/root.ts) from `z.string()` to `z.url({ protocol: /^https?$/ })`, rejecting malformed URLs and non-HTTP(S) schemes before persistence or redirection.

### Build and wire the BullMQ click-tracking pipeline

To persist click events asynchronously without blocking redirect responses, commits `bc70547` through `974f7cd` built and wired the message-queue pipeline backed by the dedicated `noeviction` Redis queue instance:

- **Schema, factories, and shared queue config (`bc70547`, `8bdb2ce`):** [schemas](../url-shorten-api/src/message-queue/schemas.ts) defines `clickBufferItemSchema` (`shortUrl`, ISO-8601 `clickedAt`, optional nullable `referrer`); [constants](../url-shorten-api/src/constants.ts) centralizes `queueNames.CLICK_QUEUE` (`"click-queue"`); [utils](../url-shorten-api/src/message-queue/utils.ts) resolves the queue URL from `QUEUE_REDIS_URL` (or `QUEUE_REDIS_HOST`/`PORT`/`PASSWORD`) and adapts `node-redis` via BullMQ's `createNodeRedisClient`; [queues](../url-shorten-api/src/message-queue/queues.ts) exposes `createClickQueue`; and [workers](../url-shorten-api/src/message-queue/workers.ts) exposes `createClickProcessor` (validating `{ items }` with Zod, skipping empty or malformed batches, batch-inserting via `ClickEvent.createAll`, and logging batch outcomes) and `createClickWorker`.
- **Standalone worker entrypoint (`fa32fd5`, `8bdb2ce`):** [mq.main.ts](../url-shorten-api/src/message-queue/mq.main.ts) boots the click worker outside Fastify with Pino structured logging, `ready`/`completed`/`failed`/`error` listeners, and idempotent `SIGINT`/`SIGTERM` shutdown (`worker.close()`, `connection.quit()`, `db.close()`). Package scripts `worker` and `worker:dev` target this entrypoint.
- **In-memory buffering and producer wiring (`f7e4ceb`, `4c5e721`):** [app.ts](../url-shorten-api/src/app.ts) registers lazy `queueConnection` and `queue` singletons with ordered `onClose` shutdown (`urlService.close()` → `queue.close()` → `queueConnection.quit()`). [root.ts](../url-shorten-api/src/routes/root.ts) forwards `Referer` (capped at 2048 chars) into `resolveUrl`. On cache hits and DB hits (never on 404), `UrlService.trackClick` buffers clicks in memory and flushes them as single `"click-batch"` jobs via `flushClickBuffer`—synchronously draining before `await` so mid-flush clicks are preserved, restoring items on failure, auto-flushing at 250 items or every 5 seconds (`.unref()` timer), and logging buffer/flush/enqueue lifecycle events.
- **Unit tests (`b443ffd`, `974f7cd`):** [click-queue tests](../url-shorten-api/test/message-queue/click-queue.test.ts) and [service tests](../url-shorten-api/test/services/url.service.test.ts) cover schema validation, valid/empty/malformed batch processing, `NodeRedisAdapter` connection preservation, shared `queueNames.CLICK_QUEUE` alignment, hit-only tracking, 250-item auto-flush, mid-flush race safety, and failure restoration.

Sources: [message-queue](../url-shorten-api/src/message-queue/), [URL service](../url-shorten-api/src/services/url.service.ts), [application wiring](../url-shorten-api/src/app.ts), [routes](../url-shorten-api/src/routes/root.ts), [click-queue tests](../url-shorten-api/test/message-queue/click-queue.test.ts), and [schema](../url-shorten-api/src/prisma/contract.prisma).

## Current implementation boundary

At `974f7cd`, the project implements a persistent shortening and redirect API, single-query `INSERT`-enforced per-user uniqueness, random `nanoid` code generation (starting at 8 characters with bounded collision retries up to length 10), HTTP(S) URL validation on shortening, Redis redirect caching, end-to-end buffered click tracking into BullMQ and PostgreSQL (`ClickEvent`) via a standalone worker, structured lifecycle logging, unit tests, and ordered client cleanup.

The schema and surrounding code have the following boundaries:

- `uid` is still stored as the literal `"example"` during registration; user accounts and JWT extraction are not yet implemented, though the schema enforces uniqueness per `(longUrl, uid)` in preparation for per-user links.
- `createdAt` is populated by the database.
- Redirects record `ClickEvent` rows asynchronously via BullMQ, but `Url.usedCount` is not yet incremented and there is no analytics endpoint.
- On Redis queue outage, failed flushes restore items into `clickBuffer` without a hard memory cap (`shortcut:` comment in [url.service.ts](../url-shorten-api/src/services/url.service.ts)), and a hard crash (`SIGKILL`) can lose clicks buffered in the last 5 seconds before a flush.

Counter-based ID allocation, coordinated multiple counter caches, and database read replicas appear in the JSDoc as alternatives or possible mitigations. They are not part of the committed runtime. Redis's one-hour expiry applies to cached entries, not to the stored links.
