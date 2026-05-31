import { type RedisClientType } from "redis";
import type { StoreProvider, WriteOptions } from "../../../types/contracts/store.js";
import { createRedisClient } from "../../redis/client.js";
import { wrapStoreError } from "../shared/store-utils.js";
import { storeKey } from "../../../kernel/keys.js";
import { STORE_KEYS } from "../../../lib/constants.js";

/**
 * RedisStoreConfig — connection and namespace options.
 */
export interface RedisStoreConfig {
  /** Redis connection URL. Defaults to redis://localhost:6379. */
  url?: string;
  /**
   * Pre-connected Redis client.
   * When provided, `url` is ignored and no new connection is created.
   * Use `createRedisClient()` to share a client with `RedisMemory`.
   */
  client?: RedisClientType;
  /** Namespace prefixed to every key: `eta:store:{namespace}:{key}` */
  namespace: string;
}

/**
 * RedisStore — Redis-backed StoreProvider.
 *
 * Key schema: `eta:store:{namespace}:{key}`
 *
 * TTL is applied via Redis `EX` (seconds) on SET.  Values are JSON-serialised.
 * The store owns its client lifecycle — call `disconnect()` to release the
 * connection when done.
 */
export class RedisStore implements StoreProvider {
  private readonly client: RedisClientType;
  private readonly ns: string;

  private constructor(client: RedisClientType, namespace: string) {
    this.client = client;
    this.ns = namespace;
  }

  /**
   * Create and connect a RedisStore.
   * Pass `config.client` to reuse an existing connection (e.g. shared with RedisMemory).
   */
  static async connect(config: RedisStoreConfig): Promise<RedisStore> {
    const client = config.client ?? (await createRedisClient(config.url));
    return new RedisStore(client, config.namespace);
  }

  async read<T = unknown>(key: string): Promise<T | null> {
    return wrapStoreError("read", key, async () => {
      const raw = await this.client.get(this.rk(key));
      if (raw === null) return null;
      return JSON.parse(raw) as T;
    });
  }

  async write<T = unknown>(
    key: string,
    value: T,
    options?: WriteOptions,
  ): Promise<void> {
    return wrapStoreError("write", key, async () => {
      const payload = JSON.stringify(value);
      if (options?.ttlMs != null) {
        const ex = Math.ceil(options.ttlMs / 1000);
        await this.client.set(this.rk(key), payload, { EX: ex });
      } else {
        await this.client.set(this.rk(key), payload);
      }
    });
  }

  async remove(key: string): Promise<void> {
    return wrapStoreError("remove", key, async () => {
      await this.client.del(this.rk(key));
    });
  }

  async list(prefix: string): Promise<string[]> {
    return wrapStoreError("list", prefix, async () => {
      const fullPrefix = storeKey(this.ns, prefix);
      const pattern = `${fullPrefix}*`;
      const strip = `${STORE_KEYS.STORE_PREFIX}${this.ns}:`;
      const keys: string[] = [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for await (const key of (this.client as any).scanIterator({
        MATCH: pattern,
      }) as AsyncIterable<string>) {
        keys.push(key.slice(strip.length));
      }
      return keys;
    });
  }

  /** Release the Redis connection gracefully. */
  async quit(): Promise<void> {
    await this.client.quit();
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private rk(key: string): string {
    return storeKey(this.ns, key);
  }
}

// ---------------------------------------------------------------------------
// createRedisStore — lazy synchronous factory
// ---------------------------------------------------------------------------

/**
 * createRedisStore — synchronous factory that returns a `StoreProvider` proxy.
 *
 * Defers `RedisStore.connect()` until the first `read()`, `write()`, `remove()`,
 * or `list()` call.  The connection promise is cached — all subsequent calls
 * reuse the same connection, so at most one TCP connection is opened.
 *
 * Use this instead of `await RedisStore.connect()` when you need a
 * module-level singleton that works in synchronous module init contexts
 * (e.g. Next.js route files, top-level `const store = createRedisStore(...)`).
 *
 * ```ts
 * const store = createRedisStore({ url: process.env.REDIS_URL!, namespace: "app" });
 * const agent = createAgent({ name: "bot", systemPrompt: "...", store });
 * ```
 */
export function createRedisStore(config: RedisStoreConfig): StoreProvider {
  let connectPromise: Promise<RedisStore> | null = null;

  function getStore(): Promise<RedisStore> {
    if (!connectPromise) {
      connectPromise = RedisStore.connect(config);
    }
    return connectPromise;
  }

  return {
    async read<T = unknown>(key: string): Promise<T | null> {
      return (await getStore()).read<T>(key);
    },
    async write<T = unknown>(
      key: string,
      value: T,
      options?: WriteOptions,
    ): Promise<void> {
      return (await getStore()).write<T>(key, value, options);
    },
    async remove(key: string): Promise<void> {
      return (await getStore()).remove(key);
    },
    async list(prefix: string): Promise<string[]> {
      return (await getStore()).list(prefix);
    },
  };
}
