import "dotenv/config";
import pino from "pino";
import { createDb } from "../prisma/db.ts";
import { createQueueConnection, getQueueRedisUrl } from "./utils.ts";
import { createClickWorker } from "./workers.ts";

const logger = pino({ level: process.env.LOG_LEVEL ?? "info" });

const db = createDb();
const connection = createQueueConnection(getQueueRedisUrl());
const worker = createClickWorker(connection, db, logger);

worker.on("ready", () => logger.info("Click worker ready"));
worker.on("completed", (job) => {
  logger.info({ jobId: job.id, name: job.name }, "Click job completed");
});
worker.on("failed", (job, err) => {
  logger.error({ jobId: job?.id, err }, "Click job failed");
});
worker.on("error", (err) => {
  logger.error({ err }, "Click worker error");
});

let shuttingDown = false;
async function shutdown(signal: NodeJS.Signals) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "Shutting down click worker...");

  const forceExit = setTimeout(() => process.exit(1), 10_000).unref();
  try {
    await worker.close();
    await connection.quit();
    await db.close();
  } catch (err) {
    logger.error({ err }, "Error during worker shutdown");
    process.exitCode = 1;
  } finally {
    clearTimeout(forceExit);
  }
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
