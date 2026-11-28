import { createNodeRedisClient } from "bullmq";
import { createClient } from "redis";

export function createQueueConnection(url: string) {
  return createNodeRedisClient(createClient({ url }));
}
