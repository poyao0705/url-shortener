import type { FastifyBaseLogger } from "fastify";
import { nanoid } from "nanoid";
import type { createClient } from "redis";
import { errorMessages } from "../constants.ts";
import type { ClickBufferItem } from "../message-queue/schemas.ts";
import type { ClickEventBatch } from "../message-queue/workers.ts";
import type { Database } from "../prisma/db.ts";

export type ClickQueue = {
  add: (name: string, data: ClickEventBatch) => Promise<unknown>;
};

const SHORT_URL_LENGTH = 8;
const PER_LENGTH_RETRIES = 3;
const MAX_RETRIES = PER_LENGTH_RETRIES * 3;
const MAX_BUFFER_SIZE = 250;
const FLUSH_INTERVAL_MS = 5_000;

export function generateShortUrl(longUrl: string, length: number): string {
  const shortUrl = nanoid(length);
  return shortUrl;
}

export class UrlService {
  private readonly db: Database;
  private readonly redisClient: ReturnType<typeof createClient>;
  private readonly logger: FastifyBaseLogger;
  private readonly queue: ClickQueue;
  private readonly clickBuffer: Array<ClickBufferItem> = [];
  private readonly flushTimer: NodeJS.Timeout;

  constructor(
    database: Database,
    redisClient: ReturnType<typeof createClient>,
    logger: FastifyBaseLogger,
    queue: ClickQueue,
  ) {
    this.db = database;
    this.redisClient = redisClient;
    this.logger = logger;
    this.queue = queue;
    this.flushTimer = setInterval(() => {
      void this.flushClickBuffer("timer").catch(() => {});
    }, FLUSH_INTERVAL_MS).unref();
  }

  async shortenUrl(longUrl: string): Promise<string> {
    let retry = 0;
    let totalRetries = 0;
    let shortUrlLength = SHORT_URL_LENGTH;

    // Say that the user id is fetched from the jwt auth token
    const uid = "example"; // this should be fetched from the auth token in production

    while (totalRetries < MAX_RETRIES) {
      const shortUrl = generateShortUrl(`${longUrl}-${retry}`, shortUrlLength);
      try {
        await this.db.orm.public.Url.create({
          shortUrl: shortUrl,
          longUrl: longUrl,
          uid: uid,
        });
        return shortUrl;
      } catch (error) {
        if (
          !(error instanceof Error) ||
          !("sqlState" in error) ||
          error.sqlState !== "23505" ||
          !("constraint" in error)
        ) {
          this.logger.error({ err: error }, "Unexpected error");
          throw error;
        }
        // The unique constraint error indicates the URL already exists
        if (error.constraint === "Url_longUrl_uid_key") {
          this.logger.error("URL already exists");
          throw new Error(errorMessages.URL_ALREADY_EXISTS);
        }
        // The primary key constraint error indicates a duplicate short URL
        if (error.constraint !== "Url_pkey") {
          this.logger.error({ err: error }, "Unexpected error");
          throw error;
        }
        this.logger.warn(`Duplicate short URL detected: ${shortUrl}`);
        retry++;
        totalRetries++;
        this.logger.warn(`Retry (${totalRetries}/${MAX_RETRIES})`);
      }
      if (totalRetries === MAX_RETRIES) {
        throw new Error(errorMessages.FAILED_TO_SHORTEN_URL);
      }
      // if we've retried too many times, increase the short URL length and reset the retry counter
      if (retry === PER_LENGTH_RETRIES) {
        shortUrlLength += 1;
        retry = 0;
      }
    }
    throw new Error(errorMessages.FAILED_TO_SHORTEN_URL);
  }

  async resolveUrl(shortUrl: string, referrer?: string | null): Promise<string> {
    // use node-redis
    const cachedUrl = await this.redisClient.get(shortUrl);
    // look up the URL in the redis cache
    if (cachedUrl) {
      if (typeof cachedUrl === "string") {
        this.logger.info("Cache hit, returning cached URL");
        this.trackClick(shortUrl, referrer);
        return cachedUrl;
      } else {
        this.logger.error("Invalid cached URL");
        throw new Error(errorMessages.INVALID_CACHED_URL);
      }
    } else {
      // if not found in cache, look up in the database
      this.logger.info("Cache miss, looking up in database");
      const url = await this.db.orm.public.Url.where({
        shortUrl: shortUrl,
      }).first();
      if (!url) {
        this.logger.error("URL not found");
        throw new Error(errorMessages.URL_NOT_FOUND);
      }
      this.logger.info("URL found, caching in redis");
      // cache the URL in redis cache
      await this.redisClient.set(shortUrl, url.longUrl, { EX: 3600 });
      this.trackClick(shortUrl, referrer);
      return url.longUrl;
    }
  }

  trackClick(shortUrl: string, referrer?: string | null): void {
    this.clickBuffer.push({
      shortUrl,
      clickedAt: new Date().toISOString(),
      referrer: referrer ?? null,
    });
    this.logger.info(
      { shortUrl, bufferSize: this.clickBuffer.length },
      "Buffered click event",
    );
    if (this.clickBuffer.length >= MAX_BUFFER_SIZE) {
      void this.flushClickBuffer("threshold").catch(() => {});
    }
  }

  async flushClickBuffer(
    reason: "threshold" | "timer" | "shutdown" | "manual" = "manual",
  ): Promise<void> {
    if (this.clickBuffer.length === 0) return;
    // Drain synchronously before awaiting so clicks arriving mid-flush are not lost.
    const items = this.clickBuffer.splice(0);
    this.logger.info({ count: items.length, reason }, "Flushing click buffer to queue");
    try {
      const job = await this.queue.add("click-batch", { items });
      const jobId =
        job && typeof job === "object" && "id" in job ? (job as { id?: string }).id : undefined;
      this.logger.info({ jobId, count: items.length, reason }, "Enqueued click batch");
    } catch (err) {
      // shortcut: re-queuing into clickBuffer is unbounded if Redis stays down; add a max cap when scaling
      this.clickBuffer.unshift(...items);
      this.logger.error(
        { err, restoredCount: items.length, reason },
        "Failed to flush click buffer, restored items",
      );
      throw err;
    }
  }

  async close(): Promise<void> {
    clearInterval(this.flushTimer);
    await this.flushClickBuffer("shutdown");
  }
}
