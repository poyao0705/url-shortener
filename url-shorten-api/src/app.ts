import * as path from "node:path";
import AutoLoad, { type AutoloadPluginOptions } from "@fastify/autoload";
import { type FastifyPluginAsync } from "fastify";
import { fileURLToPath } from "node:url";
import { createDb } from "./prisma/db.ts";
import { UrlService } from "./services/url.service.ts";

import { createContainer, InjectionMode, asClass, asFunction } from "awilix";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export type AppOptions = {
  urlService?: Pick<UrlService, "shortenUrl">;
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
    database: asFunction(createDb)
      .singleton()
      .disposer((database) => database.close()),
    urlService: asClass(UrlService).singleton(),
  });

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
