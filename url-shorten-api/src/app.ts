import * as path from "node:path";
import { fileURLToPath } from "node:url";
import AutoLoad, { type AutoloadPluginOptions } from "@fastify/autoload";
import { asClass, asFunction, asValue, createContainer, InjectionMode } from "awilix";
import type { FastifyPluginAsync } from "fastify";
import { createClient } from "redis";
import { errorMessages } from "./constants.ts";
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

  void fastify.addHook("onClose", async () => {
    await container.dispose();
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
    urlService: asClass(UrlService).singleton(),
  });

  if (!opts.urlService) {
    // resolve redisClient first and connect before creating urlService
    const redisClient = container.resolve<ReturnType<typeof createClient>>("redisClient");
    await redisClient.connect();
  }

  const urlService = opts.urlService ?? container.resolve<UrlService>("urlService");

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
    options: { ...opts, urlService },
    forceESM: true,
  });
};

export default app;
export { app, options };
