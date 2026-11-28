import { createNodeRedisClient } from "bullmq";
import { createClient } from "redis";

export function getQueueRedisUrl(): string {
  if (process.env.QUEUE_REDIS_URL) return process.env.QUEUE_REDIS_URL;
  if (process.env.QUEUE_REDIS_PASSWORD) {
    const host = process.env.QUEUE_REDIS_HOST ?? "127.0.0.1";
    const port = process.env.QUEUE_REDIS_PORT ?? "6380";
    return `redis://default:${encodeURIComponent(process.env.QUEUE_REDIS_PASSWORD)}@${host}:${port}`;
  }
  throw new Error("QUEUE_REDIS_URL is not set");
}

export function createQueueConnection(url: string) {
  return createNodeRedisClient(createClient({ url }));
}
