import { test } from "node:test";
import * as assert from "node:assert";
import { randomUUID } from "node:crypto";
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
  t.after(async () => {
    const database = createDb();
    try {
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
  assert.match(respUrl, /^http:\/\/short\.test\/[0-9a-f]{6}$/);

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
  const lookups = new Promise<void>((resolve) => { release = resolve; });
  // Hold both real lookups until both requests have checked for an existing URL.
  const gatedDatabase = {
    orm: {
      public: {
        Url: {
          where(filters: { longUrl?: string; shortUrl?: string }) {
            return {
              first: async () => {
                const row = await collection.where(filters).first();
                if (filters.longUrl === longUrl && arrivals < 2) {
                  if (++arrivals === 2) release();
                  await lookups;
                }
                return row;
              },
            };
          },
          create: collection.create.bind(collection),
        },
      },
    },
  } as unknown as Database;
  const app = await build(t, { urlService: new UrlService(gatedDatabase) });
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
