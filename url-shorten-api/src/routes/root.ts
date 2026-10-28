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

  /**
   * Shortens a URL, persists its mapping, and returns the full short URL.
   *
   * Requirement: generate a unique short code.
   *
   * Design choices:
   * 1. Counter-backed IDs: use a dedicated cache as a unique ID incrementer.
   *    - Drawback: the counter cache is a single point of failure.
   *    - Mitigation: multiple cache instances with concurrency coordination.
   * 2. Generated codes (selected): random generation was considered; the current
   *    service hashes the URL and a retry suffix.
   *    - Trade-offs: codes can collide, and retries can generate different
   *      candidates for the same URL.
   *    - Mitigation: retry collisions and increase the code length after
   *      repeated failed attempts.
   */
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
        fastify.log.error(error);
        reply.status(500).send({ error: errorMessages.INTERNAL_SERVER_ERROR });
      }
    }
  });

  /**
   * Resolves a short code and redirects to its original URL.
   *
   * Requirement: serve redirects under high traffic.
   *
   * Scaling design choices:
   * 1. Database read replicas to distribute read traffic.
   * 2. Redis caching to reduce database load.
   */
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
        fastify.log.error(error);
        reply.status(500).send({ error: errorMessages.INTERNAL_SERVER_ERROR });
      }
    }
  });
};

export default root;
