# URL shortener

A practice URL shortener built with Fastify and TypeScript. PostgreSQL stores URL mappings and click events (`Url`, `ClickEvent`), Redis caches redirect lookups for one hour, and a separate non-evicting Redis instance with a standalone BullMQ worker persists buffered redirect clicks asynchronously.

## Prerequisites

- Node.js compatible with the pinned Prisma CLI: `^22.18.0 || ^24.11.0 || >=26.0.0`.
- pnpm.
- Docker with Docker Compose, with Docker running.
- Ports `3000` (API), `5432` (PostgreSQL), `6379` (cache Redis), `6380` (queue Redis), and `8080` (Adminer) available locally.

The API and click worker run on your machine; Docker Compose runs PostgreSQL 18, two Redis instances (`redis` for caching, `redis-queue` for BullMQ), and Adminer.

## Run locally

### 1. Install dependencies

From the repository root:

```sh
cd url-shorten-api
pnpm install --frozen-lockfile
```

### 2. Configure the environment

While still in `url-shorten-api/`:

```sh
cp .env.example .env
```

Edit `.env` so the database and Redis credentials match `compose.yaml`. For a new local setup, use:

```dotenv
DATABASE_PASSWORD=local_db_password
DATABASE_URL="postgresql://app:local_db_password@localhost:5432/url_shortener"
REDIS_PASSWORD=local_redis_password
REDIS_URL="redis://default:local_redis_password@localhost:6379/0"
QUEUE_REDIS_PASSWORD=local_queue_redis_password
QUEUE_REDIS_URL="redis://default:local_queue_redis_password@localhost:6380"
```

These are example local passwords. If you change them, update both the password variable and its connection URL. Percent-encode special characters in URL passwords.

*(If `QUEUE_REDIS_URL` is omitted, the app can also build it from `QUEUE_REDIS_HOST`, `QUEUE_REDIS_PORT`, and `QUEUE_REDIS_PASSWORD`; Compose always requires `QUEUE_REDIS_PASSWORD`.)*

### 3. Start PostgreSQL and Redis

Return to the repository root:

```sh
cd ..
docker compose --env-file url-shorten-api/.env up -d
docker compose --env-file url-shorten-api/.env ps
```

Wait until PostgreSQL (`db`) is healthy and both `redis` (`6379`, `allkeys-lru`) and `redis-queue` (`6380`, `noeviction`) are running. Adminer is available at `http://localhost:8080`. The explicit `--env-file` lets Compose use the same passwords as the API and worker.

### 4. Initialize or migrate the database

Run Prisma from the API directory so it finds `prisma.config.ts` and `.env`:

```sh
cd url-shorten-api
pnpm exec prisma db init
```

This creates the tables and constraints described by the committed contract, including `Url` and `ClickEvent`.

This project uses the Prisma 8 prerelease contract workflow. Convenience scripts are defined in `url-shorten-api/package.json`:

- `pnpm contract:emit` — regenerate `contract.json` and `contract.d.ts` after editing `src/prisma/contract.prisma`.
- `pnpm migration:plan --name <slug>` — plan a new on-disk migration from contract changes.
- `pnpm db:migrate` — apply pending migrations to the database (use `--show` to preview).

See [the Prisma notes](url-shorten-api/prisma-8.md) for more context.

### 5. Start the API and click worker

From `url-shorten-api/`, start the HTTP API:

```sh
pnpm dev
```

In a second terminal (also in `url-shorten-api/`), start the standalone BullMQ click worker:

```sh
pnpm worker:dev
```

The API listens at `http://localhost:3000` and restarts on file changes. Redirect clicks are buffered in memory (flushed at 250 items, every 5 seconds, or on graceful shutdown) and persisted to `ClickEvent` by the worker.

## Try the API

In another terminal, check that the server responds:

```sh
curl http://localhost:3000/
```

Expected response:

```json
{"root":true}
```

Create a short URL (must be a valid `http://` or `https://` URL):

```sh
curl -i -X POST http://localhost:3000/shorten \
  -H 'Content-Type: application/json' \
  -d '{"longUrl":"https://example.com"}'
```

The response is `200` with a JSON body containing `respUrl`, such as `http://localhost:3000/<code>` (8-character `nanoid` code). Follow the short URL:

```sh
curl -i -H 'Referer: https://referrer.example' 'http://localhost:3000/<code>'
```

The server returns `302` with the original URL in the `Location` header and buffers a click event (`shortUrl`, ISO timestamp, optional `referrer`). Registering the same long URL again for the same user returns `409` (`URL already exists`).

| Endpoint | Behavior |
| --- | --- |
| `GET /` | Returns `{ "root": true }`. |
| `POST /shorten` | Accepts `{ "longUrl": "https://..." }` and returns `{ "respUrl": "..." }`. Non-HTTP(S) URLs or invalid bodies return `400`; duplicate URLs return `409`. |
| `GET /:shortUrl` | Redirects with `302` and tracks the click asynchronously; unknown codes return `404`. |

## Tests and compiled startup

Run these commands from `url-shorten-api/`, with `.env` configured, Docker services running, and the database initialized:

```sh
pnpm test
```

The test script compiles the application, type-checks the tests, and runs Node's test runner with coverage. Integration tests use PostgreSQL, cache Redis, and queue Redis.

To build and run the compiled API and worker instead of dev watchers:

```sh
pnpm start   # compiles and starts the API
pnpm worker  # runs the compiled click worker (run `pnpm run build:ts` first)
```

To compile without starting the server:

```sh
pnpm run build:ts
```

## Stop the project

Press `Ctrl+C` in the API and worker terminals (both flush in-flight click batches and close connections cleanly on `SIGINT`/`SIGTERM`). Then, from the repository root:

```sh
docker compose --env-file url-shorten-api/.env down
```

Docker volumes retain their data, so saved mappings, click events, and queued jobs remain available when the services start again.

## Troubleshooting

- **Compose reports a missing password (`DATABASE_PASSWORD`, `REDIS_PASSWORD`, or `QUEUE_REDIS_PASSWORD`):** create `url-shorten-api/.env` with all three password variables and include `--env-file url-shorten-api/.env` when running Compose from the repository root.
- **Connection refused or Redis authentication errors:** check `docker compose --env-file url-shorten-api/.env ps` and `docker compose --env-file url-shorten-api/.env logs db redis redis-queue` from the repository root. Confirm each URL matches its password and local port (`5432`, `6379`, `6380`).
- **The `Url` or `ClickEvent` table is missing:** run `pnpm exec prisma db init` (fresh DB) or `pnpm db:migrate` (existing DB) from `url-shorten-api/`.
- **PostgreSQL rejects a changed password:** an existing Docker database volume keeps its original database credentials. Use the password configured when that volume was initialized.

## Documentation

- [Implementation journey](docs/IMPLEMENTATION.md)
- [Architecture decision records (MADR)](docs/decisions/)
- [Learning resources](docs/RESOURCES.md)
