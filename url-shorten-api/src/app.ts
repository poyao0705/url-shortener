import * as path from "node:path";
import { fileURLToPath } from "node:url";
import AutoLoad, { type AutoloadPluginOptions } from "@fastify/autoload";
import { fastifyAwilixPlugin } from "@fastify/awilix";
import { asClass, asFunction, asValue, createContainer, InjectionMode } from "awilix";
import type { FastifyPluginAsync } from "fastify";
import { createClient } from "redis";
import { errorMessages } from "./constants.ts";
import { createClickQueue } from "./message-queue/queues.ts";
import { createQueueConnection, getQueueRedisUrl } from "./message-queue/utils.ts";
import { createDb } from "./prisma/db.ts";
import { UrlService } from "./services/url.service.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export type AppOptions = {
  urlService?: Pick<UrlService, "shortenUrl" | "resolveUrl">;
} & Partial<AutoloadPluginOptions>;

// Pass --options via CLI arguments in command to enable these options.
const options: AppOptions = {};

const app: FastifyPluginAsync<AppOptions> = async (fastify, opts): Promise<void> => {
  const container = createContainer({
    injectionMode: InjectionMode.CLASSIC,
    strict: true,
  });

  container.register({
    logger: asValue(fastify.log),
    database: asFunction(createDb)
      .singleton()
      .disposer((database) => database.close()),
    redisClient: asFunction(() => {
      const redisUrl = process.env.REDIS_URL;
      if (!redisUrl) throw new Error(errorMessages.REDIS_URL_NOT_SET);

      const redisClient = createClient({ url: redisUrl });
      redisClient.on("error", (err) => {
        fastify.log.error({ err }, "Redis error");
      });
      return redisClient;
    })
      .singleton()
      .disposer((client) => client.quit()),
    queueConnection: asFunction(() => createQueueConnection(getQueueRedisUrl())).singleton(),
    queue: asFunction((queueConnection: ReturnType<typeof createQueueConnection>) => {
      const queue = createClickQueue(queueConnection);
      queue.on("error", (err) => {
        fastify.log.error({ err }, "Click queue error");
      });
      return queue;
    }).singleton(),
    urlService: opts.urlService
      ? asValue(opts.urlService)
      : asClass(UrlService).singleton(),
  });

  fastify.addHook("onClose", async () => {
    if (!opts.urlService && container.cache.has("urlService")) {
      await container.resolve<UrlService>("urlService").close();
    }
    if (container.cache.has("queue")) {
      await container.resolve<ReturnType<typeof createClickQueue>>("queue").close();
    }
    if (container.cache.has("queueConnection")) {
      await container.resolve<ReturnType<typeof createQueueConnection>>("queueConnection").quit();
    }
  });

  await fastify.register(fastifyAwilixPlugin, {
    container,
    disposeOnClose: true,
    disposeOnResponse: true,
  });

  if (!opts.urlService) {
    const redisClient = container.resolve<ReturnType<typeof createClient>>("redisClient");
    await redisClient.connect();
  }

  // Do not touch the following lines

  // This loads all plugins defined in plugins
  // those should be support plugins that are reused
  // through your application
  // eslint-disable-next-line no-void
  void fastify.register(AutoLoad, {
    dir: path.join(__dirname, "plugins"),
    options: opts,
    forceESM: true,
  });

  // This loads all plugins defined in routes
  // define your routes in one of these
  // eslint-disable-next-line no-void
  void fastify.register(AutoLoad, {
    dir: path.join(__dirname, "routes"),
    options: opts,
    forceESM: true,
  });
};

export default app;
export { app, options };
