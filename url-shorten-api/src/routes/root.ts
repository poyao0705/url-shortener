import { type FastifyPluginAsync } from "fastify";

function generateShortUrl(): string {
  const charsForUrl = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const shortUrl = Array.from(
    { length: 6 },
    () => charsForUrl[Math.floor(Math.random() * charsForUrl.length)],
  ).join("");
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
  fastify.post("/shorten", async (request, reply) => {
    const shortUrl = generateShortUrl();
    // record the original url to the database
    // use the urlMap to store the short URL and original URL instead for now
    urlMap.set(shortUrl, (request.body as UrlRequest).longUrl);
    // append the short URL to the base URL
    const respUrl = `${request.protocol}://${request.host}/${shortUrl}`;
    reply.send({ respUrl });
  });

  // Get method do redirect
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
