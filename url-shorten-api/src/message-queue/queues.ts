import { Queue, type ConnectionOptions } from "bullmq";
import { queueNames } from "../constants.ts";

export function createClickQueue(connection: ConnectionOptions): Queue {
  return new Queue(queueNames.CLICK_QUEUE, { connection });
}
