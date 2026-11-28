# Use Redis cache-aside for redirect lookups

## Context and Problem Statement

Redirect traffic (`GET /:shortUrl`) is read-heavy compared to link creation (`POST /shorten`). Querying PostgreSQL on every redirect adds avoidable database load and latency for frequently accessed short links.

## Considered Options

* Query PostgreSQL directly on every redirect
* Scale reads with PostgreSQL read replicas
* Use Redis cache-aside with a 1-hour TTL and `allkeys-lru` eviction

## Decision Outcome

Chosen option: "Use Redis cache-aside with a 1-hour TTL and `allkeys-lru` eviction", because it serves hot redirects directly from memory with minimal operational complexity, populates only links that are actually visited, and bounds memory usage automatically in [compose.yaml](../../compose.yaml) and [url.service.ts](../../url-shorten-api/src/services/url.service.ts).

### Consequences

* Good, because repeated redirects hit Redis (`6379`) without touching PostgreSQL.
* Good, because registration writes only to PostgreSQL and 404 lookups are not cached, keeping cache memory focused on active links.
* Good, because the 256 MB `allkeys-lru` policy and 3600-second expiry prevent unbounded cache growth.
* Bad, because the first redirect for any link incurs a cache miss and a PostgreSQL lookup.
* Bad, because Redis read/write errors currently propagate as `500` responses rather than degrading to a direct PostgreSQL lookup.
* Bad, because external link updates or deletions remain stale in Redis until the 1-hour TTL expires.
