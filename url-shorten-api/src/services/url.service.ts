import crypto from "crypto";
import { errorMessages } from "../constants.js";
import type { Database } from "../prisma/db.js";

const SHORT_URL_LENGTH = 6;
const PER_LENGTH_RETRIES = 3;
const MAX_RETRIES = PER_LENGTH_RETRIES * 3;

export function generateShortUrl(longUrl: string, length: number): string {
  const shortUrl = crypto.createHash("md5").update(longUrl).digest("hex").slice(0, length);
  return shortUrl;
}

export class UrlService {
  private readonly db: Database;

  constructor(database: Database) {
    this.db = database;
  }

  //   generateShortUrl(longUrl: string): string {
  //     // Version 1:
  //     // const charsForUrl = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  //     // const shortUrl = Array.from(
  //     //   { length: 6 },
  //     //   () => charsForUrl[Math.floor(Math.random() * charsForUrl.length)],
  //     // ).join("");
  //     // return shortUrl;
  //
  //     // Version 2: Hash the long URL to generate a short URL
  //     const shortUrl = crypto
  //       .createHash("md5")
  //       .update(longUrl)
  //       .digest("hex")
  //       .slice(0, SHORT_URL_LENGTH);
  //     return shortUrl;
  //   }
  //
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
          throw error;
        }
        if (error.constraint === "Url_longUrl_key") {
          throw new Error(errorMessages.URL_ALREADY_EXISTS);
        }
        if (error.constraint !== "Url_pkey") {
          throw error;
        }
        retry++;
        totalRetries++;
      }
      if (totalRetries === MAX_RETRIES) {
        throw new Error("Failed to shorten URL");
      }
      // if we've retried too many times, increase the short URL length and reset the retry counter
      if (retry === PER_LENGTH_RETRIES) {
        // throw new Error("Failed to shorten URL");
        shortUrlLength += 1;
        retry = 0;
      }
    }
    throw new Error("Failed to shorten URL");

    // try {
    //   // query the database to check if the short URL already exists
    //   while (retry < MAX_RETRIES) {
    //     const shortUrl = generateShortUrl(`${longUrl}-${retry}`, shortUrlLength);
    //     const existingUrl = await this.db.url.findUnique({
    //       where: { shortUrl },
    //     });
    //     if (!existingUrl) {
    //       // return shortUrl;
    //       await this.db.url.create({
    //         data: { shortUrl, longUrl },
    //       });
    //       return shortUrl;
    //     }
    //     retry++;
    //
    //   }
    //
    // } catch (error) {
    //   throw new Error("Failed to shorten URL");
    // }
  }

  async resolveUrl(shortUrl: string): Promise<string> {
    const url = await this.db.orm.public.Url.where({ shortUrl: shortUrl }).first();
    if (!url) {
      throw new Error("URL not found");
    }
    return url.longUrl;
  }
}
