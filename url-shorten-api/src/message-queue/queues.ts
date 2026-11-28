import { Queue, type ConnectionOptions } from "bullmq";

export function createClickQueue(connection: ConnectionOptions) {
  return new Queue("clicks", { connection });
}
