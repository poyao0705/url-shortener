import * as assert from "node:assert";
import { test } from "node:test";
import { Worker, type Job } from "bullmq";
import type { FastifyBaseLogger } from "fastify";
import { createClickQueue } from "../../src/message-queue/queues.js";
import { clickBufferItemSchema } from "../../src/message-queue/schemas.js";
import { createQueueConnection } from "../../src/message-queue/utils.js";
import {
  createClickProcessor,
  createClickWorker,
  type ClickEventBatch,
} from "../../src/message-queue/workers.js";
import type { Database } from "../../src/prisma/db.js";

function buildDeps(t: test.TestContext) {
  const createAll = t.mock.fn(async () => []);
  const database = {
    orm: { public: { ClickEvent: { createAll } } },
  } as unknown as Database;
  const info = t.mock.fn();
  const error = t.mock.fn();
  const logger = { info, warn() {}, error } as unknown as FastifyBaseLogger;
  return { database, logger, createAll, info, error };
}

test("clickBufferItemSchema validates ISO timestamps and optional referrer", () => {
  const valid = clickBufferItemSchema.safeParse({
    shortUrl: "abc123",
    clickedAt: "2026-11-28T07:28:22.123Z",
  });
  assert.equal(valid.success, true);

  const withNullReferrer = clickBufferItemSchema.safeParse({
    shortUrl: "abc123",
    clickedAt: "2026-11-28T07:28:22.123Z",
    referrer: null,
  });
  assert.equal(withNullReferrer.success, true);

  assert.equal(
    clickBufferItemSchema.safeParse({ shortUrl: "abc123", clickedAt: "not-a-date" }).success,
    false,
  );
  assert.equal(
    clickBufferItemSchema.safeParse({ clickedAt: "2026-11-28T07:28:22.123Z" }).success,
    false,
  );
});

test("createClickProcessor inserts valid click batches", async (t) => {
  const { database, logger, createAll, error } = buildDeps(t);
  const processJob = createClickProcessor(database, logger);
  const items = [
    { shortUrl: "abc123", clickedAt: "2026-11-28T07:28:22.123Z", referrer: "https://ref.test" },
    { shortUrl: "xyz789", clickedAt: "2026-11-28T07:29:00.000Z", referrer: null },
  ];

  await processJob({ id: "job-1", data: { items } } as unknown as Job<ClickEventBatch>);

  assert.equal(error.mock.callCount(), 0);
  assert.equal(createAll.mock.callCount(), 1);
  assert.deepStrictEqual(createAll.mock.calls[0].arguments, [items]);
});

test("createClickProcessor skips DB write for empty batches", async (t) => {
  const { database, logger, createAll, error } = buildDeps(t);
  const processJob = createClickProcessor(database, logger);

  await processJob({ id: "job-empty", data: { items: [] } } as unknown as Job<ClickEventBatch>);

  assert.equal(error.mock.callCount(), 0);
  assert.equal(createAll.mock.callCount(), 0);
});

test("createClickProcessor logs and skips DB write for invalid or malformed payloads", async (t) => {
  const { database, logger, createAll, error } = buildDeps(t);
  const processJob = createClickProcessor(database, logger);

  await processJob({
    id: "job-bad-item",
    data: { items: [{ shortUrl: "abc123", clickedAt: "invalid" }] },
  } as unknown as Job<ClickEventBatch>);
  await processJob({ id: "job-null-data", data: null } as unknown as Job<ClickEventBatch>);

  assert.equal(createAll.mock.callCount(), 0);
  assert.equal(error.mock.callCount(), 2);
});

test("createClickQueue and createClickWorker preserve the NodeRedisAdapter connection", async (t) => {
  const { database, logger } = buildDeps(t);
  // Prevent Worker constructor from polling Redis during unit test.
  t.mock.method(Worker.prototype, "run", async () => {});

  const connection = createQueueConnection("redis://127.0.0.1:6380");
  assert.equal(typeof connection.quit, "function");

  const queue = createClickQueue(connection);
  const worker = createClickWorker(connection, database, logger);
  t.after(async () => {
    await worker.close(true);
    await queue.close();
  });

  assert.equal(queue.name, "clicks");
  assert.equal(worker.name, "clicks");
  assert.strictEqual(queue.opts.connection, connection);
  assert.strictEqual(worker.opts.connection, connection);
});
