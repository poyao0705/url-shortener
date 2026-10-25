import { type FastifyPluginAsync } from "fastify";
import crypto from "crypto";

const SHORT_URL_LENGTH = 6;

function generateShortUrl(longUrl: string): string {
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

const urlMap = new Map<string, string>();

type UrlRequest = {
  longUrl: string;
};

const root: FastifyPluginAsync = async (fastify, opts): Promise<void> => {
  fastify.get("/", async function (request, reply) {
    return { root: true };
  });

  // Post method to shorten a URL
  //
  // Functional Requirement: generate unique short URL
  // Design choices 1:
  // Counter (A separate cache to serve as a unique id incrementer)
  // Drawback: introduce a single point of failure (the counter cache)
  // Solution: add another multiple cache service (need to handle concurrency)
  //
  // Design choices 2 (V):
  // Randomly generate short URL
  // Drawback: high collision rate (same URL can map to different short URLs)
  // Solution: retry when collision occurs. Only if multiple retries happen then add one character space in the short URL
  fastify.post("/shorten", async (request, reply) => {
    const { longUrl } = request.body as UrlRequest;
    const shortUrl = generateShortUrl(longUrl);
    // record the original url to the database
    // use the urlMap to store the short URL and original URL instead for now
    urlMap.set(shortUrl, longUrl);
    // append the short URL to the base URL
    const respUrl = `${request.protocol}://${request.host}/${shortUrl}`;
    reply.send({ respUrl });
  });

  // Get method do redirect
  //
  // Requirement: How to handle high traffic
  // Design choice 1:
  // Use db replicas
  // Design choice 2:
  // Use Redis cache to reduce database load
  fastify.get("/:shortUrl", async (request, reply) => {
    const { shortUrl } = request.params as { shortUrl: string };
    const url = urlMap.get(shortUrl); // query the database for the URL
    if (!url) {
      reply.status(404).send({ error: "URL not found" });
      return;
    }
    reply.redirect(url);
  });
};

export default root;
