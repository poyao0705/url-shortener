import * as assert from "node:assert";
import { test } from "node:test";
import Fastify, { type FastifyBaseLogger } from "fastify";
import type { createClient } from "redis";
import { errorMessages } from "../../src/constants.js";
import type { ClickEventBatch } from "../../src/message-queue/workers.js";
import type { Database } from "../../src/prisma/db.js";
import { UrlService } from "../../src/services/url.service.js";

type UrlRecord = { shortUrl: string; longUrl: string; uid: string };

function buildService(
  create: (data: UrlRecord) => Promise<unknown>,
  {
    find = async () => null,
    get = async () => null,
    set = async () => "OK",
    add = async () => undefined,
    logger = { info() {}, warn() {}, error() {} } as unknown as FastifyBaseLogger,
  }: {
    find?: (filters: { shortUrl?: string; longUrl?: string; uid?: string }) => Promise<UrlRecord | null>;
    get?: (key: string) => Promise<unknown>;
    set?: (key: string, value: string, options: { EX: number }) => Promise<unknown>;
    add?: (name: string, data: ClickEventBatch) => Promise<unknown>;
    logger?: FastifyBaseLogger;
  } = {},
) {
  const database = {
    orm: {
      public: {
        Url: {
          where: (filters: { shortUrl?: string; longUrl?: string; uid?: string }) => ({
            first: () => find(filters),
          }),
          create,
        },
      },
    },
  } as unknown as Database;
  const redisClient = { get, set } as unknown as ReturnType<typeof createClient>;
  return new UrlService(database, redisClient, logger, { add });
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

test("shortenUrl rejects an existing longUrl for the same uid without inserting", async (t) => {
  const longUrl = "https://example.com/existing";
  const find = t.mock.fn(async () => ({
    shortUrl: "abc123",
    longUrl,
    uid: "example",
  }));
  const create = t.mock.fn(async () => undefined);
  const service = buildService(create, { find });

  await assert.rejects(service.shortenUrl(longUrl), {
    message: errorMessages.URL_ALREADY_EXISTS,
  });
  assert.deepStrictEqual(find.mock.calls.map((call) => call.arguments), [
    [{ longUrl, uid: "example" }],
  ]);
  assert.equal(create.mock.callCount(), 0);
});

test("shortenUrl scopes the existing-URL lookup by uid so another user's URL does not block shortening", async (t) => {
  const longUrl = "https://example.com/shared";
  const existingRecords: UrlRecord[] = [
    { shortUrl: "other1", longUrl, uid: "other-user" },
  ];
  const find = t.mock.fn(
    async (filters: { shortUrl?: string; longUrl?: string; uid?: string }) =>
      existingRecords.find(
        (record) =>
          (filters.shortUrl === undefined || record.shortUrl === filters.shortUrl) &&
          (filters.longUrl === undefined || record.longUrl === filters.longUrl) &&
          (filters.uid === undefined || record.uid === filters.uid),
      ) ?? null,
  );
  const create = t.mock.fn(async (_data: UrlRecord) => undefined);
  const service = buildService(create, { find });

  const shortUrl = await service.shortenUrl(longUrl);

  assert.deepStrictEqual(find.mock.calls.map((call) => call.arguments), [
    [{ longUrl, uid: "example" }],
  ]);
  assert.equal(create.mock.callCount(), 1);
  assert.deepStrictEqual(create.mock.calls[0]?.arguments, [
    { shortUrl, longUrl, uid: "example" },
  ]);
});

test("a long URL + uid insert conflict is reported as already existing without retries", async () => {
  let attempts = 0;
  const service = buildService(async () => {
    attempts++;
    throw Object.assign(new Error("duplicate long URL"), {
      sqlState: "23505",
      constraint: "Url_longUrl_uid_key",
    });
  });

  await assert.rejects(service.shortenUrl("https://example.com/duplicate"), {
    message: errorMessages.URL_ALREADY_EXISTS,
  });
  assert.equal(attempts, 1);
});

test("a short-code collision retries with a different code", async () => {
  const candidates: string[] = [];
  const warnings: string[] = [];
  const logger = {
    info() {},
    warn(message: string) { warnings.push(message); },
    error() {},
  } as unknown as FastifyBaseLogger;
  const service = buildService(async ({ shortUrl }) => {
    candidates.push(shortUrl);
    if (candidates.length === 1) {
      throw Object.assign(new Error("duplicate short code"), {
        sqlState: "23505",
        constraint: "Url_pkey",
      });
    }
  }, { logger });

  const shortUrl = await service.shortenUrl("https://example.com/collision");
  assert.equal(candidates.length, 2);
  assert.notEqual(candidates[0], candidates[1]);
  assert.equal(shortUrl, candidates[1]);
  assert.deepStrictEqual(warnings, [
    `Duplicate short URL detected: ${candidates[0]}`,
    "Retry (1/9)",
  ]);
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
  test(`logs and rethrows ${name} unchanged without retrying`, async (t) => {
    const logs: Array<{ err?: { message: string; stack: string } }> = [];
    const app = Fastify({
      logger: {
        stream: {
          write(line: string) { logs.push(JSON.parse(line)); },
        },
      },
    });
    t.after(() => app.close());
    let attempts = 0;
    const service = buildService(async () => {
      attempts++;
      if (attempts === 1) throw error;
    }, { logger: app.log });

    await assert.rejects(
      service.shortenUrl("https://example.com/failure"),
      (caught) => caught === error,
    );
    assert.equal(attempts, 1);
    assert.equal(logs.length, 1);
    assert.equal(logs[0]?.err?.message, error.message);
    assert.equal(logs[0]?.err?.stack, error.stack);
  });
}

test("resolveUrl tracks clicks on hits and flushes them as a single batch job", async (t) => {
  const add = t.mock.fn(async (_name: string, _data: ClickEventBatch) => undefined);
  const service = buildService(async () => undefined, {
    get: async (key) => (key === "cached" ? "https://example.com/cached" : null),
    find: async (filters) =>
      filters.shortUrl === "from-db"
        ? { shortUrl: "from-db", longUrl: "https://example.com/db", uid: "u1" }
        : null,
    add,
  });
  t.after(() => service.close());

  await service.resolveUrl("cached", "https://ref.test");
  await service.resolveUrl("from-db");
  await assert.rejects(service.resolveUrl("missing"), { message: errorMessages.URL_NOT_FOUND });

  assert.equal(add.mock.callCount(), 0);
  await service.flushClickBuffer();

  assert.equal(add.mock.callCount(), 1);
  const [jobName, payload] = add.mock.calls[0].arguments;
  assert.equal(jobName, "click-batch");
  assert.equal(payload.items.length, 2);
  assert.equal(payload.items[0].shortUrl, "cached");
  assert.equal(payload.items[0].referrer, "https://ref.test");
  assert.equal(payload.items[1].shortUrl, "from-db");
  assert.equal(payload.items[1].referrer, null);
});

test("trackClick auto-flushes when buffer reaches 250 items", async (t) => {
  const add = t.mock.fn(async (_name: string, _data: ClickEventBatch) => undefined);
  const service = buildService(async () => undefined, { add });
  t.after(() => service.close());

  for (let i = 0; i < 249; i++) {
    service.trackClick(`code-${i}`);
  }
  assert.equal(add.mock.callCount(), 0);

  service.trackClick("code-249");
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(add.mock.callCount(), 1);
  assert.equal(add.mock.calls[0].arguments[1].items.length, 250);
});

test("flushClickBuffer preserves clicks arriving mid-flush and restores on failure", async (t) => {
  let release!: () => void;
  let shouldFail = false;
  const batches: ClickEventBatch[] = [];
  const add = t.mock.fn(async (_name: string, data: ClickEventBatch) => {
    if (shouldFail) throw new Error("redis down");
    if (batches.length === 0) {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    }
    batches.push(data);
  });
  const service = buildService(async () => undefined, { add });
  t.after(() => service.close());

  service.trackClick("before-flush");
  const flushing = service.flushClickBuffer();
  // Click arrives while the first flush is awaiting Redis.
  service.trackClick("during-flush");
  release();
  await flushing;

  assert.equal(batches.length, 1);
  assert.deepStrictEqual(batches[0].items.map((item) => item.shortUrl), ["before-flush"]);

  // Failed flush restores items for the next flush.
  shouldFail = true;
  await assert.rejects(service.flushClickBuffer(), { message: "redis down" });

  shouldFail = false;
  await service.flushClickBuffer();
  assert.equal(batches.length, 2);
  assert.deepStrictEqual(batches[1].items.map((item) => item.shortUrl), ["during-flush"]);
});
