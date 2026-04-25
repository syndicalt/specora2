import { beforeEach, describe, expect, it, vi } from "vitest";

const instances: any[] = [];

vi.mock("ioredis", () => {
  const RedisMock = vi.fn(function (_url: string, _options: any) {
    const handlers = new Map<string, Function>();
    const instance = {
      on: vi.fn((event: string, handler: Function) => {
        handlers.set(event, handler);
        return instance;
      }),
      quit: vi.fn(async () => {}),
      emit: (event: string, arg?: any) => handlers.get(event)?.(arg),
    };
    instances.push(instance);
    return instance;
  });

  return {
    default: RedisMock,
  };
});

describe("redis service", () => {
  beforeEach(async () => {
    instances.length = 0;
    vi.resetModules();
  });

  it("creates a Redis client and tracks availability on connect/error", async () => {
    const redis = await import("./redis");
    const client = redis.getRedis() as any;

    expect(client).toBeTruthy();
    expect(redis.getRedis()).toBe(client);
    expect(redis.isRedisAvailable()).toBe(false);

    client.emit("connect");
    expect(redis.isRedisAvailable()).toBe(true);

    client.emit("error", new Error("down"));
    expect(redis.isRedisAvailable()).toBe(false);
  });

  it("creates a Redis subscriber", async () => {
    const redis = await import("./redis");
    const subscriber = redis.getRedisSubscriber() as any;

    expect(subscriber).toBeTruthy();
    expect(redis.getRedisSubscriber()).toBe(subscriber);
  });

  it("closes clients and resets availability", async () => {
    const redis = await import("./redis");
    const client = redis.getRedis() as any;
    const subscriber = redis.getRedisSubscriber() as any;

    client.emit("connect");
    await redis.closeRedis();

    expect(client.quit).toHaveBeenCalledOnce();
    expect(subscriber.quit).toHaveBeenCalledOnce();
    expect(redis.isRedisAvailable()).toBe(false);
  });
});
