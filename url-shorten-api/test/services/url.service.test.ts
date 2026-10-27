import * as assert from "node:assert";
import { test } from "node:test";
import { errorMessages } from "../../src/constants.js";
import type { Database } from "../../src/prisma/db.js";
import { UrlService } from "../../src/services/url.service.js";

function buildService(create: (data: {
  shortUrl: string;
  longUrl: string;
  uid: string;
}) => Promise<unknown>) {
  const database = {
    orm: {
      public: {
        Url: {
          where: () => ({ first: async () => null }),
          create,
        },
      },
    },
  } as unknown as Database;
  return new UrlService(database);
}

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
