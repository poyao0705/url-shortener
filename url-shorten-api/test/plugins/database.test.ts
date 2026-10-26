import { test } from "node:test";
import * as assert from "node:assert";
import { build } from "../helper.js";
import type { Database } from "../../src/prisma/db.js";
import { UrlService } from "../../src/services/url.service.js";

test("apps close only their own database client", async (t) => {
  const clients: Database[] = [];
  const generateShortUrl = UrlService.prototype.generateShortUrl;

  // The service does not query the database yet, so capture its injected client.
  t.mock.method(
    UrlService.prototype,
    "generateShortUrl",
    function (this: UrlService, longUrl: string) {
      clients.push(Reflect.get(this, "db") as Database);
      return generateShortUrl.call(this, longUrl);
    },
  );

  const firstApp = await build(t);
  const secondApp = await build(t);

  for (const app of [firstApp, secondApp]) {
    const response = await app.inject({
      method: "POST",
      url: "/shorten",
      payload: { longUrl: "https://example.com/database-ownership" },
    });
    assert.equal(response.statusCode, 200);
  }

  assert.equal(clients.length, 2);
  const [firstClient, secondClient] = clients;
  assert.notStrictEqual(firstClient, secondClient);

  const firstClose = t.mock.method(firstClient, "close");
  const secondClose = t.mock.method(secondClient, "close");

  const overriddenApp = await build(t, {
    urlService: { generateShortUrl: () => "fake-service" },
  });
  await overriddenApp.ready();
  await overriddenApp.close();
  assert.equal(firstClose.mock.callCount(), 0);
  assert.equal(secondClose.mock.callCount(), 0);

  await firstApp.close();
  assert.equal(firstClose.mock.callCount(), 1);
  assert.equal(secondClose.mock.callCount(), 0);

  await firstApp.close();
  assert.equal(firstClose.mock.callCount(), 1);

  const response = await secondApp.inject({
    method: "POST",
    url: "/shorten",
    payload: { longUrl: "https://example.com/still-running" },
  });
  assert.equal(response.statusCode, 200);
  assert.strictEqual(clients[2], secondClient);

  await secondApp.close();
  assert.equal(secondClose.mock.callCount(), 1);
});
