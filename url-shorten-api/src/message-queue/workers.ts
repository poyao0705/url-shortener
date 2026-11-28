import { Worker, type ConnectionOptions, type Job } from "bullmq";
import type { FastifyBaseLogger } from "fastify";
import { z } from "zod";
import type { Database } from "../prisma/db.ts";
import { clickBufferItemSchema, type ClickBufferItem } from "./schemas.ts";
import { queueNames } from "../constants.ts";

export type ClickEventBatch = {
  items: ClickBufferItem[];
};

const clickEventBatchSchema = z.object({
  items: z.array(clickBufferItemSchema),
});

export function createClickProcessor(database: Database, logger: FastifyBaseLogger) {
  return async (job: Job<ClickEventBatch>) => {
    logger.info({ jobId: job.id }, "Processing click event batch");
    const parsed = clickEventBatchSchema.safeParse(job.data);
    if (!parsed.success) {
      logger.error({ jobId: job.id, error: parsed.error }, "Failed to process click event batch");
      return;
    }
    if (parsed.data.items.length === 0) {
      logger.info({ jobId: job.id }, "Skipping empty click event batch");
      return;
    }

    await database.orm.public.ClickEvent.createAll(parsed.data.items);
    logger.info({ jobId: job.id, count: parsed.data.items.length }, "Persisted click event batch");
  };
}

export function createClickWorker(
  connection: ConnectionOptions,
  database: Database,
  logger: FastifyBaseLogger,
) {
  return new Worker(queueNames.CLICK_QUEUE, createClickProcessor(database, logger), {
    connection,
  });
}
