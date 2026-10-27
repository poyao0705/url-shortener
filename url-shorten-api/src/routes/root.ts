import { type FastifyPluginAsync } from "fastify";
import type { UrlService } from "../services/url.service.js";
import { z, ZodError } from "zod";

interface RootRoutesOptions {
  urlService: Pick<UrlService, "generateShortUrl">;
}

const urlMap = new Map<string, string>();


const root: FastifyPluginAsync<RootRoutesOptions> = async (
  fastify,
  { urlService },
): Promise<void> => {
  fastify.get("/", async function () {
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
    // const { longUrl } = request.body as UrlRequest;
    try {
      const { longUrl } = z.object({ longUrl: z.string() }).parse(request.body);

      const shortUrl = urlService.generateShortUrl(longUrl);
      // record the original url to the database
      // use the urlMap to store the short URL and original URL instead for now
      urlMap.set(shortUrl, longUrl);
      // append the short URL to the base URL
      const respUrl = `${request.protocol}://${request.host}/${shortUrl}`;
      reply.send({ respUrl });
    } catch (error) {
      if (error instanceof ZodError) {
        reply.status(400).send({ error: "Invalid request body" });
      } else {
        reply.status(500).send({ error: "Internal server error" });
      }
    }
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
