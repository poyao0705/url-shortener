import type { FastifyPluginAsync } from "fastify";
import { ZodError, z } from "zod";
import { errorMessages } from "../constants.ts";
import type { UrlService } from "../services/url.service.ts";

interface RootRoutesOptions {
  urlService: Pick<UrlService, "shortenUrl" | "resolveUrl">;
}

// const urlMap = new Map<string, string>();

const root: FastifyPluginAsync<RootRoutesOptions> = async (
  fastify,
  { urlService },
): Promise<void> => {
  fastify.get("/", async () => ({ root: true }));

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
    try {
      const { longUrl } = z.object({ longUrl: z.string() }).parse(request.body);

      const shortUrl = await urlService.shortenUrl(longUrl);
      // record the original url to the database
      // append the short URL to the base URL
      const respUrl = `${request.protocol}://${request.host}/${shortUrl}`;
      reply.send({ respUrl });
    } catch (error) {
      if (error instanceof ZodError) {
        reply.status(400).send({ error: errorMessages.INVALID_REQUEST_BODY });
      } else if (error instanceof Error && errorMessages.URL_ALREADY_EXISTS === error.message) {
        reply.status(409).send({ error: errorMessages.URL_ALREADY_EXISTS });
      } else {
        reply.status(500).send({ error: errorMessages.INTERNAL_SERVER_ERROR });
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
    try {
      const { shortUrl } = z.object({ shortUrl: z.string() }).parse(request.params);
      const url = await urlService.resolveUrl(shortUrl);
      if (!url) {
        throw new Error(errorMessages.URL_NOT_FOUND);
      }
      reply.redirect(url);
    } catch (error) {
      if (error instanceof ZodError) {
        reply.status(400).send({ error: errorMessages.INVALID_REQUEST_BODY });
      } else if (error instanceof Error && errorMessages.URL_NOT_FOUND === error.message) {
        reply.status(404).send({ error: errorMessages.URL_NOT_FOUND });
      } else {
        reply.status(500).send({ error: errorMessages.INTERNAL_SERVER_ERROR });
      }
    }
  });
};

export default root;
