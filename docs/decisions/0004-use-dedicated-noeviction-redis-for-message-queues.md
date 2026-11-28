# Use a dedicated `noeviction` Redis instance for BullMQ queues

## Context and Problem Statement

BullMQ stores job payloads, queue indexes, and worker locks in Redis. The existing Redis instance (`6379`) is configured with `allkeys-lru` eviction for redirect caching, which can silently evict queue metadata or pending jobs under memory pressure.

## Considered Options

* Reuse the existing cache Redis instance (`6379`, `allkeys-lru`)
* Run a dedicated Redis instance (`6380`) configured with `noeviction` and append-only persistence

## Decision Outcome

Chosen option: "Run a dedicated Redis instance (`6380`) configured with `noeviction` and append-only persistence", because BullMQ requires `noeviction` to prevent corrupted queue state and silent job loss, while keeping redirect cache eviction independent in [compose.yaml](../../compose.yaml) and [utils.ts](../../url-shorten-api/src/message-queue/utils.ts).

### Consequences

* Good, because cache churn on port `6379` can never evict queued click-tracking jobs or BullMQ lock keys.
* Good, because AOF persistence and separate memory budgets isolate queue durability from caching.
* Bad, because local and production setups must run and configure a second Redis instance (port `6380` and queue credentials).
* Bad, because BullMQ treats external `createNodeRedisClient` adapters as shared connections and does not quit them on `close()`, so callers ([app.ts](../../url-shorten-api/src/app.ts) and [mq.main.ts](../../url-shorten-api/src/message-queue/mq.main.ts)) must explicitly call `connection.quit()` during shutdown.
