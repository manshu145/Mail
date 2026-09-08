import Redis from "ioredis";

let client: Redis | null = null;

export function isRedisConfigured() {
  return Boolean(process.env.REDIS_URL);
}

export function getRedis() {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    throw new Error("REDIS_URL is not configured");
  }

  if (!client) {
    client = new Redis(redisUrl, {
      maxRetriesPerRequest: 1,
      enableReadyCheck: true,
      lazyConnect: true,
      connectTimeout: 3000,
    });
  }

  return client;
}
