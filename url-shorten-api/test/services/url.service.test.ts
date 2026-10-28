import * as assert from "node:assert";
import { test } from "node:test";
import type { FastifyBaseLogger } from "fastify";
import type { createClient } from "redis";
import { errorMessages } from "../../src/constants.js";
import type { Database } from "../../src/prisma/db.js";
import { UrlService } from "../../src/services/url.service.js";

type UrlRecord = { shortUrl: string; longUrl: string; uid: string };

function buildService(
  create: (data: UrlRecord) => Promise<unknown>,
  {
    find = async () => null,
    get = async () => null,
    set = async () => "OK",
  }: {
    find?: (filters: { shortUrl?: string; longUrl?: string }) => Promise<UrlRecord | null>;
    get?: (key: string) => Promise<unknown>;
    set?: (key: string, value: string, options: { EX: number }) => Promise<unknown>;
  } = {},
) {
  const database = {
    orm: {
      public: {
        Url: {
          where: (filters: { shortUrl?: string; longUrl?: string }) => ({
            first: () => find(filters),
          }),
          create,
        },
      },
    },
  } as unknown as Database;
  const redisClient = { get, set } as unknown as ReturnType<typeof createClient>;
  const logger = { info() {}, warn() {}, error() {} } as unknown as FastifyBaseLogger;
  return new UrlService(database, redisClient, logger);
}

test("resolveUrl returns a cache hit without a database lookup or cache write", async (t) => {
  const get = t.mock.fn(async () => "https://example.com/cached");
  const find = t.mock.fn(async () => null);
  const set = t.mock.fn(async () => "OK");
  const service = buildService(async () => undefined, { get, find, set });

  assert.equal(await service.resolveUrl("abc123"), "https://example.com/cached");
  assert.deepStrictEqual(get.mock.calls.map((call) => call.arguments), [["abc123"]]);
  assert.equal(find.mock.callCount(), 0);
  assert.equal(set.mock.callCount(), 0);
});

for (const [name, cachedUrl] of [["missing", null], ["empty", ""]] as const) {
  test(`resolveUrl caches the database result for one hour when the cache entry is ${name}`, async (t) => {
    const get = t.mock.fn(async () => cachedUrl);
    const find = t.mock.fn(async () => ({
      shortUrl: "abc123",
      longUrl: "https://example.com/database",
      uid: "test-user",
    }));
    const set = t.mock.fn(async () => "OK");
    const service = buildService(async () => undefined, { get, find, set });

    assert.equal(await service.resolveUrl("abc123"), "https://example.com/database");
    assert.deepStrictEqual(find.mock.calls.map((call) => call.arguments), [
      [{ shortUrl: "abc123" }],
    ]);
    assert.deepStrictEqual(set.mock.calls.map((call) => call.arguments), [
      ["abc123", "https://example.com/database", { EX: 3600 }],
    ]);
  });
}

test("resolveUrl reuses the populated cache on subsequent lookups", async (t) => {
  const cache = new Map<string, string>();
  const get = t.mock.fn(async (key: string) => cache.get(key) ?? null);
  const set = t.mock.fn(async (key: string, value: string) => {
    cache.set(key, value);
    return "OK";
  });
  const find = t.mock.fn(async () => ({
    shortUrl: "abc123",
    longUrl: "https://example.com/populated",
    uid: "test-user",
  }));
  const service = buildService(async () => undefined, { get, find, set });

  assert.equal(await service.resolveUrl("abc123"), "https://example.com/populated");
  assert.equal(await service.resolveUrl("abc123"), "https://example.com/populated");
  assert.equal(get.mock.callCount(), 2);
  assert.equal(find.mock.callCount(), 1);
  assert.equal(set.mock.callCount(), 1);
});

test("resolveUrl reports a missing URL without caching it", async (t) => {
  const find = t.mock.fn(async () => null);
  const set = t.mock.fn(async () => "OK");
  const service = buildService(async () => undefined, { find, set });

  await assert.rejects(service.resolveUrl("missing"), {
    message: errorMessages.URL_NOT_FOUND,
  });
  assert.deepStrictEqual(find.mock.calls.map((call) => call.arguments), [
    [{ shortUrl: "missing" }],
  ]);
  assert.equal(set.mock.callCount(), 0);
});

test("resolveUrl rejects a non-string cache entry without falling back to the database", async (t) => {
  const get = t.mock.fn(async () => ({ longUrl: "https://example.com/invalid-cache" }));
  const find = t.mock.fn(async () => null);
  const set = t.mock.fn(async () => "OK");
  const service = buildService(async () => undefined, { get, find, set });

  await assert.rejects(service.resolveUrl("abc123"), {
    message: errorMessages.INVALID_CACHED_URL,
  });
  assert.equal(find.mock.callCount(), 0);
  assert.equal(set.mock.callCount(), 0);
});

test("resolveUrl propagates cache read failures without querying the database", async (t) => {
  const failure = new Error("Redis read failed");
  const get = t.mock.fn(async () => { throw failure; });
  const find = t.mock.fn(async () => null);
  const set = t.mock.fn(async () => "OK");
  const service = buildService(async () => undefined, { get, find, set });

  await assert.rejects(service.resolveUrl("abc123"), (error) => error === failure);
  assert.equal(find.mock.callCount(), 0);
  assert.equal(set.mock.callCount(), 0);
});

test("resolveUrl propagates database failures without populating the cache", async (t) => {
  const failure = new Error("Database read failed");
  const find = t.mock.fn(async () => { throw failure; });
  const set = t.mock.fn(async () => "OK");
  const service = buildService(async () => undefined, { find, set });

  await assert.rejects(service.resolveUrl("abc123"), (error) => error === failure);
  assert.equal(set.mock.callCount(), 0);
});

test("resolveUrl propagates cache write failures", async (t) => {
  const failure = new Error("Redis write failed");
  const find = t.mock.fn(async () => ({
    shortUrl: "abc123",
    longUrl: "https://example.com/database",
    uid: "test-user",
  }));
  const set = t.mock.fn(async () => { throw failure; });
  const service = buildService(async () => undefined, { find, set });

  await assert.rejects(service.resolveUrl("abc123"), (error) => error === failure);
  assert.deepStrictEqual(set.mock.calls.map((call) => call.arguments), [
    ["abc123", "https://example.com/database", { EX: 3600 }],
  ]);
});

test("a long URL insert conflict is reported as already existing without retries", async () => {
  let attempts = 0;
  const service = buildService(async () => {
    attempts++;
    throw Object.assign(new Error("duplicate long URL"), {
      sqlState: "23505",
      constraint: "Url_longUrl_key",
    });
  });

  await assert.rejects(service.shortenUrl("https://example.com/duplicate"), {
    message: errorMessages.URL_ALREADY_EXISTS,
  });
  assert.equal(attempts, 1);
});

test("a short-code collision retries with a different code", async () => {
  const candidates: string[] = [];
  const service = buildService(async ({ shortUrl }) => {
    candidates.push(shortUrl);
    if (candidates.length === 1) {
      throw Object.assign(new Error("duplicate short code"), {
        sqlState: "23505",
        constraint: "Url_pkey",
      });
    }
  });

  const shortUrl = await service.shortenUrl("https://example.com/collision");
  assert.equal(candidates.length, 2);
  assert.notEqual(candidates[0], candidates[1]);
  assert.equal(shortUrl, candidates[1]);
});

test("persistent short-code collisions stop after nine attempts", async () => {
  const candidates: string[] = [];
  const service = buildService(async ({ shortUrl }) => {
    candidates.push(shortUrl);
    throw Object.assign(new Error("duplicate short code"), {
      sqlState: "23505",
      constraint: "Url_pkey",
    });
  });

  await assert.rejects(service.shortenUrl("https://example.com/exhausted"), {
    message: errorMessages.FAILED_TO_SHORTEN_URL,
  });
  assert.equal(candidates.length, 9);
  assert.deepStrictEqual(candidates.map((candidate) => candidate.length), [
    6, 6, 6, 7, 7, 7, 8, 8, 8,
  ]);
});

for (const [name, error] of [
  ["connection failures", Object.assign(new Error("connection lost"), { sqlState: "08006" })],
  ["unexpected errors", new Error("unexpected insertion failure")],
  ["unrelated unique constraints", Object.assign(new Error("another constraint"), {
    sqlState: "23505",
    constraint: "Another_key",
  })],
] as const) {
  test(`rethrows ${name} unchanged without retrying`, async () => {
    let attempts = 0;
    const service = buildService(async () => {
      attempts++;
      if (attempts === 1) throw error;
    });

    await assert.rejects(
      service.shortenUrl("https://example.com/failure"),
      (caught) => caught === error,
    );
    assert.equal(attempts, 1);
  });
}
