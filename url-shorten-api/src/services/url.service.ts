import crypto from "crypto";
import type { Database } from "../prisma/db.js";

const SHORT_URL_LENGTH = 6;

export class UrlService {
  private readonly db: Database;

  constructor(database: Database) {
    this.db = database;
  }

  generateShortUrl(longUrl: string): string {
    // Version 1:
    // const charsForUrl = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    // const shortUrl = Array.from(
    //   { length: 6 },
    //   () => charsForUrl[Math.floor(Math.random() * charsForUrl.length)],
    // ).join("");
    // return shortUrl;

    // Version 2: Hash the long URL to generate a short URL
    const shortUrl = crypto
      .createHash("md5")
      .update(longUrl)
      .digest("hex")
      .slice(0, SHORT_URL_LENGTH);
    return shortUrl;
  }
}
