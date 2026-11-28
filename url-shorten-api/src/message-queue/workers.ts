import { Worker, type ConnectionOptions, type Job } from "bullmq";
import type { FastifyBaseLogger } from "fastify";
import { z } from "zod";
import type { Database } from "../prisma/db.ts";
import { clickBufferItemSchema, type ClickBufferItem } from "./schemas.ts";

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
      logger.error(
        { jobId: job.id, error: parsed.error },
        "Failed to process click event batch",
      );
      return;
    }
    if (parsed.data.items.length === 0) return;

    await database.orm.public.ClickEvent.createAll(parsed.data.items);
  };
}

export function createClickWorker(
  connection: ConnectionOptions,
  database: Database,
  logger: FastifyBaseLogger,
) {
  return new Worker("clicks", createClickProcessor(database, logger), {
    connection,
  });
}
