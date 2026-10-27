import { test } from "node:test";
import * as assert from "node:assert";
import { randomUUID } from "node:crypto";
import { createDb } from "../../src/prisma/db.js";
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
