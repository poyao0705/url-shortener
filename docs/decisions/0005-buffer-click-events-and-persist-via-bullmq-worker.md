# Buffer click events in memory and persist batches via a standalone BullMQ worker

## Context and Problem Statement

Each successful redirect (`GET /:shortUrl`) should record a `ClickEvent` (`shortUrl`, `clickedAt`, `referrer`) in PostgreSQL for analytics without adding database write latency to redirects or overwhelming PostgreSQL with one `INSERT` per click during traffic spikes.

## Considered Options

* Insert a `ClickEvent` row synchronously into PostgreSQL during `GET /:shortUrl`
* Enqueue one BullMQ job per click directly on each redirect
* Buffer clicks in memory (`250` items / `5s` timer / shutdown drain) and enqueue single batch jobs consumed by a standalone BullMQ worker

## Decision Outcome

Chosen option: "Buffer clicks in memory (`250` items / `5s` timer / shutdown drain) and enqueue single batch jobs consumed by a standalone BullMQ worker", because it keeps redirects non-blocking, amortizes both Redis commands and PostgreSQL writes into single batch operations (`ClickEvent.createAll`), and isolates background DB writes in [mq.main.ts](../../url-shorten-api/src/message-queue/mq.main.ts), [url.service.ts](../../url-shorten-api/src/services/url.service.ts), and [workers.ts](../../url-shorten-api/src/message-queue/workers.ts).

### Consequences

* Good, because redirects only append to an in-memory array and never wait on PostgreSQL or BullMQ.
* Good, because up to 250 clicks become one Redis job (`click-batch`) and one bulk SQL insert, while the 5-second `.unref()` timer and `onClose` drain flush low-traffic buffers promptly.
* Good, because draining via `clickBuffer.splice(0)` before `await` prevents losing clicks that arrive mid-flush, and Zod validates deserialized job payloads at the worker boundary.
* Good, because running the worker as a separate process lets background ingestion scale and shut down cleanly (`SIGINT`/`SIGTERM`) without affecting API responsiveness.
* Bad, because an abrupt process crash (`SIGKILL`) can lose clicks buffered since the last 5-second or 250-item flush.
* Bad, because failed flushes currently re-queue items back into `clickBuffer` without a hard memory cap if `redis-queue` stays unavailable for an extended period.
* Bad, because operators must run the standalone worker process (`pnpm worker` / `pnpm worker:dev`) alongside the API.
