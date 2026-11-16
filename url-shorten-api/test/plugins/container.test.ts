import { test } from "node:test";
import * as assert from "node:assert";
import { asFunction, type AwilixContainer } from "awilix";
import Fastify from "fastify";
import App from "../../src/app.js";
import { build } from "../helper.js";

const longUrl = "https://example.com/container";

test("injected service is registered without infrastructure", async (t) => {
  const redisUrl = process.env.REDIS_URL;
  process.env.REDIS_URL = "";
  t.after(() => {
    if (redisUrl === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = redisUrl;
  });

  const urlService = {
    shortenUrl: async () => "fake-code",
    resolveUrl: async () => longUrl,
  };
  const app = await build(t, { urlService });

  assert.ok(app.diContainer.resolve("urlService") === urlService, "container must resolve the fake service");

  const shortened = await app.inject({
    method: "POST",
    url: "/shorten",
    headers: { host: "short.test" },
    payload: { longUrl },
  });
  assert.equal(shortened.statusCode, 200);
  assert.deepStrictEqual(shortened.json(), { respUrl: "http://short.test/fake-code" });

  const redirect = await app.inject({ url: "/fake-code" });
  assert.equal(redirect.statusCode, 302);
  assert.equal(redirect.headers.location, longUrl);
  assert.equal(app.diContainer.cache.has("database"), false);
  assert.equal(app.diContainer.cache.has("redisClient"), false);
});

test("app containers and overrides are independent", async (t) => {
  const firstService = {
    shortenUrl: async () => "first-code",
    resolveUrl: async () => longUrl,
  };
  const secondService = {
    shortenUrl: async () => "second-code",
    resolveUrl: async () => longUrl,
  };
  const firstApp = await build(t, { urlService: firstService });
  const secondApp = await build(t, { urlService: secondService });

  assert.ok(firstApp.diContainer !== secondApp.diContainer, "apps must own separate containers");
  assert.ok(firstApp.diContainer.resolve("urlService") === firstService, "first app must resolve its own service");
  assert.ok(secondApp.diContainer.resolve("urlService") === secondService, "second app must resolve its own service");

  await firstApp.close();
  const response = await secondApp.inject({
    method: "POST",
    url: "/shorten",
    payload: { longUrl },
  });
  assert.equal(response.statusCode, 200);
  assert.equal(new URL(response.json().respUrl).pathname, "/second-code");
});

test("requests use distinct disposable scopes", async (t) => {
  const app = Fastify();
  t.after(() => app.close());
  const scopes: AwilixContainer[] = [];
  const services: object[] = [];
  const disposed: string[] = [];

  app.addHook("preHandler", async (request) => {
    const code = `scope-${scopes.push(request.diScope)}`;
    request.diScope.register({
      urlService: asFunction(() => {
        const service = {
          shortenUrl: async () => code,
          resolveUrl: async () => longUrl,
        };
        services.push(service);
        return service;
      })
        .scoped()
        .disposer(() => { disposed.push(code); }),
    });
  });
  await app.register(App, {
    urlService: {
      shortenUrl: async () => "app-code",
      resolveUrl: async () => longUrl,
    },
  });

  const shortened = await app.inject({
    method: "POST",
    url: "/shorten",
    payload: { longUrl },
  });
  assert.equal(shortened.statusCode, 200);
  assert.equal(new URL(shortened.json().respUrl).pathname, "/scope-1");
  assert.deepStrictEqual(disposed, ["scope-1"]);

  const redirect = await app.inject({ url: "/scope-1" });
  assert.equal(redirect.statusCode, 302);
  assert.equal(redirect.headers.location, longUrl);
  assert.equal(scopes.length, 2);
  assert.ok(scopes[0] !== scopes[1], "requests must own separate scopes");
  assert.equal(services.length, 2);
  assert.ok(services[0] !== services[1], "requests must resolve separate scoped services");
  assert.deepStrictEqual(disposed, ["scope-1", "scope-2"]);
});

test("app container is disposed once", async (t) => {
  const app = await build(t, {
    urlService: {
      shortenUrl: async () => "fake-code",
      resolveUrl: async () => longUrl,
    },
  });
  const dispose = t.mock.method(app.diContainer, "dispose");

  await app.close();
  await app.close();
  assert.equal(dispose.mock.callCount(), 1);
});
