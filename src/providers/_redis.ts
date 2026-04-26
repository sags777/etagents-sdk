import { createClient, type RedisClientType } from "redis";

// ---------------------------------------------------------------------------
// createRedisClient — shared Redis connection factory
// ---------------------------------------------------------------------------

/**
 * createRedisClient — creates and connects a Redis client.
 *
 * Share the returned client between `RedisStore` and `RedisMemory` to avoid
 * opening two connections for the same Redis instance:
 *
 * ```ts
 * const client = await createRedisClient(process.env.REDIS_URL);
 * const store = await RedisStore.connect({ client, namespace: "myapp" });
 * const memory = await RedisMemory.connect({ client, namespace: "myapp", embedder, vectorDim: 1536 });
 * ```
 *
 * Connection-level errors are swallowed — individual operations will throw
 * `StoreError` / `MemoryError` with operation context.
 */
export async function createRedisClient(url?: string): Promise<RedisClientType> {
  const client = createClient({ url }) as RedisClientType;
  client.on("error", () => {
    // Swallow connection-level errors — operations will throw typed errors
  });
  await client.connect();
  return client;
}
