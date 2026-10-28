import crypto from "crypto";
import { errorMessages } from "../constants.ts";
import type { Database } from "../prisma/db.ts";
import { createClient } from "redis";
import type { FastifyBaseLogger } from "fastify";

const SHORT_URL_LENGTH = 6;
const PER_LENGTH_RETRIES = 3;
const MAX_RETRIES = PER_LENGTH_RETRIES * 3;

export function generateShortUrl(longUrl: string, length: number): string {
  const shortUrl = crypto.createHash("md5").update(longUrl).digest("hex").slice(0, length);
  return shortUrl;
}

export class UrlService {
  private readonly db: Database;
  private readonly redisClient: ReturnType<typeof createClient>;
  private readonly logger: FastifyBaseLogger;

  constructor(
    database: Database,
    redisClient: ReturnType<typeof createClient>,
    logger: FastifyBaseLogger,
  ) {
    this.db = database;
    this.redisClient = redisClient;
    this.logger = logger;
  }

  async shortenUrl(longUrl: string): Promise<string> {
    let retry = 0;
    let totalRetries = 0;
    let shortUrlLength = SHORT_URL_LENGTH;

    // Check if the URL already exists in the database
    const existingUrl = await this.db.orm.public.Url.where({
      longUrl: longUrl,
    }).first();
    if (existingUrl) {
      throw new Error(errorMessages.URL_ALREADY_EXISTS);
    }

    while (totalRetries < MAX_RETRIES) {
      try {
        const shortUrl = generateShortUrl(`${longUrl}-${retry}`, shortUrlLength);
        await this.db.orm.public.Url.create({
          shortUrl: shortUrl,
          longUrl: longUrl,
          uid: "example",
        });
        return shortUrl;
      } catch (error) {
        if (
          !(error instanceof Error) ||
          !("sqlState" in error) ||
          error.sqlState !== "23505" ||
          !("constraint" in error)
        ) {
          this.logger.error("Unexpected error");
          throw error;
        }
        if (error.constraint === "Url_longUrl_key") {
          this.logger.error("URL already exists");
          throw new Error(errorMessages.URL_ALREADY_EXISTS);
        }
        if (error.constraint !== "Url_pkey") {
          this.logger.error("Unexpected error");
          throw error;
        }
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

  async resolveUrl(shortUrl: string): Promise<string> {
    // use node-redis
    const cachedUrl = await this.redisClient.get(shortUrl);
    // look up the URL in the redis cache
    if (cachedUrl) {
      if (typeof cachedUrl === "string") {
        this.logger.info("Cache hit, returning cached URL");
        return cachedUrl;
      } else {
        this.logger.error("Invalid cached URL");
        throw new Error(errorMessages.INVALID_CACHED_URL);
      }
    } else {
      // if not found in cache, look up in the database
      this.logger.info("Cache miss, looking up in database");
      const url = await this.db.orm.public.Url.where({ shortUrl: shortUrl }).first();
      if (!url) {
        this.logger.error("URL not found");
        throw new Error(errorMessages.URL_NOT_FOUND);
      }
      this.logger.info("URL found, caching in redis");
      // cache the URL in redis cache
      await this.redisClient.set(shortUrl, url.longUrl, { EX: 3600 });
      return url.longUrl;
    }
  }
}
