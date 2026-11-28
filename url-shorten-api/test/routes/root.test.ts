import { test } from "node:test";
import * as assert from "node:assert";
import { randomUUID } from "node:crypto";
import type { FastifyBaseLogger } from "fastify";
import type { createClient } from "redis";
import { errorMessages } from "../../src/constants.js";
import { createDb, type Database } from "../../src/prisma/db.js";
import { UrlService } from "../../src/services/url.service.js";
import { build } from "../helper.js";

test("default root route", async (t) => {
  const app = await build(t);

  const res = await app.inject({
    url: "/",
  });
  assert.deepStrictEqual(JSON.parse(res.payload), { root: true });
});

test("shortens and redirects with the default URL service", async (t) => {
  const app = await build(t);
  const longUrl = `https://example.com/default-service/${randomUUID()}`;
  let shortUrl: string | undefined;
  t.after(async () => {
    const database = createDb();
    try {
      if (shortUrl) {
        await database.orm.public.ClickEvent.where({ shortUrl }).deleteAll();
      }
      await database.orm.public.Url.where({ longUrl }).delete();
    } finally {
      await database.close();
    }
  });

  const res = await app.inject({
    method: "POST",
    url: "/shorten",
    headers: { host: "short.test" },
    payload: { longUrl },
  });

  assert.equal(res.statusCode, 200);
  const { respUrl } = res.json();
  assert.match(respUrl, /^http:\/\/short\.test\/[A-Za-z0-9_-]{8}$/);
  shortUrl = new URL(respUrl).pathname.slice(1);

  const redirect = await app.inject({ url: new URL(respUrl).pathname });
  assert.equal(redirect.statusCode, 302);
  assert.equal(redirect.headers.location, longUrl);
});

test("concurrent registrations of the same URL return 200 and 409", { timeout: 10_000 }, async (t) => {
  const longUrl = `https://example.com/concurrent-registration/${randomUUID()}`;
  const database = createDb();
  const collection = database.orm.public.Url;
  t.after(async () => {
    try {
      await collection.where({ longUrl }).delete();
    } finally {
      await database.close();
    }
  });

  let arrivals = 0;
  let release!: () => void;
  const inserts = new Promise<void>((resolve) => { release = resolve; });
  // Hold both inserts so both requests race against the unique constraint together.
  const gatedDatabase = {
    orm: {
      public: {
        Url: {
          where: collection.where.bind(collection),
          create: async (data: { shortUrl: string; longUrl: string; uid: string }) => {
            if (data.longUrl === longUrl && arrivals < 2) {
              if (++arrivals === 2) release();
              await inserts;
            }
            return collection.create(data);
          },
        },
      },
    },
  } as unknown as Database;
  const cache = new Map<string, string>();
  const redisClient = {
    get: async (key: string) => cache.get(key) ?? null,
    set: async (key: string, value: string) => {
      cache.set(key, value);
      return "OK";
    },
  } as unknown as ReturnType<typeof createClient>;
  const logger = { info() {}, warn() {}, error() {} } as unknown as FastifyBaseLogger;
  const urlService = new UrlService(gatedDatabase, redisClient, logger, {
    add: async () => undefined,
  });
  t.after(() => urlService.close());
  const app = await build(t, { urlService });
  const register = () => app.inject({
    method: "POST",
    url: "/shorten",
    payload: { longUrl },
  });

  const responses = await Promise.all([register(), register()]);
  assert.deepStrictEqual(responses.map((response) => response.statusCode).sort(), [200, 409]);
  assert.equal((await collection.where({ longUrl }).all()).length, 1);

  const success = responses.find((response) => response.statusCode === 200);
  assert.ok(success);
  const redirect = await app.inject({ url: new URL(success.json().respUrl).pathname });
  assert.equal(redirect.statusCode, 302);
  assert.equal(redirect.headers.location, longUrl);
  assert.equal((await register()).statusCode, 409);
});

test("invalid body returns 400 without calling the injected service", async (t) => {
  const app = await build(t, {
    urlService: {
      shortenUrl: async () => { throw new Error("invalid input reached the service"); },
      resolveUrl: async () => "https://example.com/unused",
    },
  });

  const response = await app.inject({ method: "POST", url: "/shorten", payload: {} });
  assert.equal(response.statusCode, 400);
  assert.deepStrictEqual(response.json(), { error: errorMessages.INVALID_REQUEST_BODY });
});

test("duplicate URL from the injected service returns 409", async (t) => {
  const app = await build(t, {
    urlService: {
      shortenUrl: async () => { throw new Error(errorMessages.URL_ALREADY_EXISTS); },
      resolveUrl: async () => "https://example.com/unused",
    },
  });

  const response = await app.inject({
    method: "POST",
    url: "/shorten",
    payload: { longUrl: "https://example.com/duplicate" },
  });
  assert.equal(response.statusCode, 409);
  assert.deepStrictEqual(response.json(), { error: errorMessages.URL_ALREADY_EXISTS });
});

test("missing URL from the injected service returns 404", async (t) => {
  const app = await build(t, {
    urlService: {
      shortenUrl: async () => "unused-code",
      resolveUrl: async (shortUrl: string) => {
        assert.equal(shortUrl, "missing-code");
        throw new Error(errorMessages.URL_NOT_FOUND);
      },
    },
  });

  const response = await app.inject({ url: "/missing-code" });
  assert.equal(response.statusCode, 404);
  assert.deepStrictEqual(response.json(), { error: errorMessages.URL_NOT_FOUND });
});

for (const method of ["POST", "GET"] as const) {
  test(`unexpected ${method} service errors return a generic 500`, async (t) => {
    const app = await build(t, {
      urlService: {
        shortenUrl: async () => { throw new Error("private database details"); },
        resolveUrl: async () => { throw new Error("private cache details"); },
      },
    });

    const response = await app.inject(method === "POST"
      ? { method, url: "/shorten", payload: { longUrl: "https://example.com/unexpected" } }
      : { method, url: "/unexpected-code" });
    assert.equal(response.statusCode, 500);
    assert.deepStrictEqual(response.json(), { error: errorMessages.INTERNAL_SERVER_ERROR });
  });
}

test("uses the injected URL service when shortening a URL", async (t) => {
  const longUrl = "https://example.com/injected-service";
  const app = await build(t, {
    urlService: {
      async shortenUrl(url: string) {
        assert.equal(url, longUrl);
        return "di-code";
      },
      async resolveUrl(shortUrl: string) {
        assert.equal(shortUrl, "di-code");
        return longUrl;
      },
    },
  });

  const res = await app.inject({
    method: "POST",
    url: "/shorten",
    headers: { host: "short.test" },
    payload: { longUrl },
  });

  assert.equal(res.statusCode, 200);
  assert.deepStrictEqual(res.json(), { respUrl: "http://short.test/di-code" });

  const redirect = await app.inject({ url: "/di-code" });
  assert.equal(redirect.statusCode, 302);
  assert.equal(redirect.headers.location, longUrl);
});
