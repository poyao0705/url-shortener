# Use an app-local Awilix container via `@fastify/awilix` for dependency injection

## Context and Problem Statement

The API needs to wire `database`, `redisClient`, `queueConnection`, `queue`, `logger`, and `UrlService` into Fastify route handlers while keeping application instances isolated in tests and ensuring all connections close cleanly on shutdown.

## Considered Options

* Pass service instances explicitly through `@fastify/autoload` route options
* Register dependencies directly as Fastify instance decorators
* Create an app-local Awilix container exposed through `@fastify/awilix`

## Decision Outcome

Chosen option: "Create an app-local Awilix container exposed through `@fastify/awilix`", because it avoids process-global singletons and route-option plumbing, provides per-request disposable scopes (`request.diScope`), supports `AppOptions.urlService` overrides for infrastructure-free tests, and ties resource cleanup to Fastify's shutdown lifecycle in [app.ts](../../url-shorten-api/src/app.ts).

### Consequences

* Good, because multiple Fastify app instances in tests own separate containers and close only their own clients.
* Good, because injecting a fake `urlService` skips creating database, Redis, and BullMQ connections entirely.
* Good, because Awilix `strict: true` catches unregistered dependency typos immediately.
* Bad, because `InjectionMode.CLASSIC` couples class constructor parameter names to exact container registration keys.
* Bad, because Fastify runs `onClose` hooks in LIFO order, so the custom queue/buffer shutdown hook must stay registered after `fastifyAwilixPlugin` to run before `container.dispose()` clears `container.cache`.
