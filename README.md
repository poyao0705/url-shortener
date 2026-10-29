# URL shortener

A practice URL shortener built with Fastify and TypeScript. PostgreSQL stores URL mappings, and Redis caches redirect lookups for one hour.

## Prerequisites

- Node.js compatible with the pinned Prisma CLI: `^22.18.0 || ^24.11.0 || >=26.0.0`.
- pnpm.
- Docker with Docker Compose, with Docker running.
- Ports `3000`, `5432`, and `6379` available locally.

The API runs on your machine; Docker Compose runs PostgreSQL 18 and Redis.

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

Edit `.env` so the database name and user match `compose.yaml`. For a new local setup, use:

```dotenv
DATABASE_PASSWORD=local_db_password
DATABASE_URL="postgresql://app:local_db_password@localhost:5432/url_shortener"
REDIS_PASSWORD=local_redis_password
REDIS_URL="redis://default:local_redis_password@localhost:6379/0"
```

These are example local passwords. If you change them, update both the password variable and its connection URL. Percent-encode special characters in URL passwords. The generic database user and database name in `.env.example` must be replaced with `app` and `url_shortener` for the supplied Compose setup.

### 3. Start PostgreSQL and Redis

Return to the repository root:

```sh
cd ..
docker compose --env-file url-shorten-api/.env up -d
docker compose --env-file url-shorten-api/.env ps
```

Wait until PostgreSQL (`db`) is healthy and Redis is running. Both services bind to localhost and store their data in Docker volumes. The explicit `--env-file` lets Compose use the same passwords as the API.

### 4. Initialize the database

Run the Prisma command from the API directory so it finds the configuration and `.env` file:

```sh
cd url-shorten-api
pnpm exec prisma db init
```

This creates the tables and constraints described by the committed contract, including the `Url` table. Initializing the database is required before shortening or resolving links.

This project uses the Prisma 8 prerelease contract workflow. After pulling later schema changes with committed migrations, use `pnpm exec prisma db migrate`. See [the Prisma notes](url-shorten-api/prisma-8.md) for more context.

### 5. Start the API

While still in `url-shorten-api/`:

```sh
pnpm dev
```

The API listens at `http://localhost:3000` and restarts when source files change. Keep PostgreSQL and Redis running; the default application connects to Redis during startup.

## Try the API

In another terminal, check that the server responds:

```sh
curl http://localhost:3000/
```

Expected response:

```json
{"root":true}
```

Create a short URL:

```sh
curl -i -X POST http://localhost:3000/shorten \
  -H 'Content-Type: application/json' \
  -d '{"longUrl":"https://example.com"}'
```

The response is `200` with a JSON body containing `respUrl`, such as `http://localhost:3000/<code>`. Open the returned URL in a browser, or replace `<code>` below with the returned short code:

```sh
curl -i 'http://localhost:3000/<code>'
```

The server returns `302` with the original URL in the `Location` header. Registering the same long URL again returns `409` (`URL already exists`); use a different URL to create another mapping.

| Endpoint | Behavior |
| --- | --- |
| `GET /` | Returns `{ "root": true }`. |
| `POST /shorten` | Accepts `{ "longUrl": "..." }` and returns `{ "respUrl": "..." }`. Invalid request bodies return `400`; duplicate long URLs return `409`. |
| `GET /:shortUrl` | Redirects to the stored URL with `302`; unknown codes return `404`. |

## Tests and compiled startup

Run these commands from `url-shorten-api/`, with `.env` configured, both services running, and the database initialized:

```sh
pnpm test
```

The test script compiles the application, type-checks the tests, and runs Node's test runner with coverage. Integration tests use PostgreSQL and Redis.

To build and start the compiled application instead of the development watcher:

```sh
pnpm start
```

To compile without starting the server:

```sh
pnpm run build:ts
```

## Stop the project

Press `Ctrl+C` in the API terminal. Then, from the repository root:

```sh
docker compose --env-file url-shorten-api/.env down
```

Docker volumes retain their data, so saved mappings remain available when the services start again.

## Troubleshooting

- **Compose reports a missing password:** create `url-shorten-api/.env` and include `--env-file url-shorten-api/.env` when running Compose from the repository root.
- **Connection refused or Redis authentication errors:** check `docker compose --env-file url-shorten-api/.env ps` and `docker compose --env-file url-shorten-api/.env logs db redis` from the repository root. Confirm the connection URLs use the matching passwords and local ports.
- **The `Url` table is missing:** run `pnpm exec prisma db init` from `url-shorten-api/` against the configured database.
- **PostgreSQL rejects a changed password:** an existing Docker database volume keeps its original database credentials. Use the password configured when that volume was initialized.

For the feature history and design decisions, see [the implementation journey](docs/IMPLEMENTATION.md).
