import Redis from "ioredis";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

let redisClient: Redis | null = null;
let redisSubscriber: Redis | null = null;
let redisAvailable = false;

export function getRedis(): Redis | null {
  if (redisClient) return redisClient;
  try {
    redisClient = new Redis(REDIS_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => {
        if (times > 3) return null; // stop retrying after 3 attempts
        return Math.min(times * 100, 2000);
      },
    });
    redisClient.on("error", (err) => {
      // Silently handle Redis errors to prevent crashes
      if (redisAvailable) {
        console.warn("Redis connection error:", err.message);
        redisAvailable = false;
      }
    });
    redisClient.on("connect", () => {
      redisAvailable = true;
    });
    return redisClient;
  } catch {
    return null;
  }
}

export function getRedisSubscriber(): Redis | null {
  if (redisSubscriber) return redisSubscriber;
  try {
    redisSubscriber = new Redis(REDIS_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => {
        if (times > 3) return null;
        return Math.min(times * 100, 2000);
      },
    });
    redisSubscriber.on("error", (err) => {
      if (redisAvailable) {
        console.warn("Redis subscriber error:", err.message);
        redisAvailable = false;
      }
    });
    return redisSubscriber;
  } catch {
    return null;
  }
}

export function isRedisAvailable(): boolean {
  return redisAvailable;
}

export async function closeRedis(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
  }
  if (redisSubscriber) {
    await redisSubscriber.quit();
    redisSubscriber = null;
  }
  redisAvailable = false;
}
