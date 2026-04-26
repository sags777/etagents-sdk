import { type RedisClientType } from "redis";
import type {
  MemoryProvider,
  MemoryEntry,
  MemoryScope,
  MemorySearchOptions,
  MemoryMatch,
} from "../../../interfaces/memory.js";
import { MemoryError } from "../../../errors.js";
import { createRedisClient } from "../../_redis.js";

// ---------------------------------------------------------------------------
// Local types
// ---------------------------------------------------------------------------

/** Minimal embedder contract — not exported. */
interface EmbedderI {
  embed(text: string): Promise<number[]>;
}

export interface RedisMemoryConfig {
  /** Redis connection URL. Defaults to redis://localhost:6379. */
  url?: string;
  /**
   * Pre-connected Redis client.
   * When provided, `url` is ignored and no new connection is created.
   * Use `createRedisClient()` to share a client with `RedisStore`.
   */
  client?: RedisClientType;
  /** Instance namespace — prefixed to every key for isolation. */
  namespace: string;
  /** Embedder used for indexing and query vectors. */
  embedder: EmbedderI;
  /** Number of float32 dimensions in each embedding vector. */
  vectorDim: number;
  /** Entry TTL in days. Defaults to 7. */
  ttlDays?: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Pack a number[] into a little-endian FLOAT32 Buffer for Redis Stack. */
function packFloat32(vec: number[]): Buffer {
  const buf = Buffer.allocUnsafe(vec.length * 4);
  for (let i = 0; i < vec.length; i++) {
    buf.writeFloatLE(vec[i], i * 4);
  }
  return buf;
}

/** Escape special characters in Redis tag filter values. */
function escapeTag(v: string): string {
  return v.replace(/[-[\]{}()*+?,\\^$|#\s]/g, "\\$&");
}

// ---------------------------------------------------------------------------
// RedisMemory
// ---------------------------------------------------------------------------

/**
 * RedisMemory — Redis Stack-backed MemoryProvider with HNSW vector search.
 *
 * Key schema:  `eta:mem:{namespace}:{agentId}:{scope.namespace}:{id}`
 * Index name:  `eta:mem:idx:{namespace}`
 * TTL:         stored via Redis EXPIRE (default 7 days)
 * Vectors:     FLOAT32 HNSW with COSINE distance
 *
 * Requires Redis Stack (RedisSearch module) for FT commands.
 * Tests for this provider are gated behind an env flag — unit tests
 * use InMemory instead.
 */
export class RedisMemory implements MemoryProvider {
  private readonly client: RedisClientType;
  private readonly embedder: EmbedderI;
  private readonly ns: string;
  private readonly ttlSecs: number;
  private readonly vectorDim: number;
  private indexReady = false;

  private constructor(client: RedisClientType, config: Omit<RedisMemoryConfig, "url">) {
    this.client = client;
    this.embedder = config.embedder;
    this.ns = config.namespace;
    this.ttlSecs = (config.ttlDays ?? 7) * 86_400;
    this.vectorDim = config.vectorDim;
  }

  /** Create, connect, and return a ready-to-use RedisMemory instance. */
  static async connect(config: RedisMemoryConfig): Promise<RedisMemory> {
    const client = config.client ?? await createRedisClient(config.url);
    const inst = new RedisMemory(client, config);
    await inst.ensureIndex();
    return inst;
  }

  async index(entry: MemoryEntry): Promise<void> {
    // Must not throw — per MemoryProvider contract
    try {
      const vec = await this.embedder.embed(entry.text);
      await this.client.hSet(this.entryKey(entry.scope, entry.id), {
        id: entry.id,
        agentId: entry.scope.agentId,
        scopeNs: entry.scope.namespace,
        userId: entry.scope.userId ?? "",
        text: entry.text,
        metadata: JSON.stringify(entry.metadata ?? {}),
        vector: packFloat32(vec),
      });
      await this.client.expire(this.entryKey(entry.scope, entry.id), this.ttlSecs);
    } catch {
      // Swallow per contract
    }
  }

  async search(query: string, options?: MemorySearchOptions): Promise<MemoryMatch[]> {
    try {
      const limit = options?.limit ?? 10;
      const minScore = options?.minScore ?? 0;
      const scopeFilter = options?.scope;

      const queryVec = await this.embedder.embed(query);
      const vecBuf = packFloat32(queryVec);

      // Build TAG filter expression
      const parts: string[] = [];
      if (scopeFilter?.agentId) parts.push(`@agentId:{${escapeTag(scopeFilter.agentId)}}`);
      if (scopeFilter?.namespace) parts.push(`@scopeNs:{${escapeTag(scopeFilter.namespace)}}`);
      if (scopeFilter?.userId) parts.push(`@userId:{${escapeTag(scopeFilter.userId)}}`);
      const prefilter = parts.length > 0 ? `(${parts.join(" ")})` : "*";

      // FT.SEARCH with KNN (requires Redis Stack + DIALECT 2)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res = await (this.client.ft as any).search(
        this.indexName(),
        `${prefilter}=>[KNN ${limit} @vector $vec AS __dist]`,
        {
          PARAMS: { vec: vecBuf },
          SORTBY: { BY: "__dist" },
          LIMIT: { from: 0, size: limit },
          DIALECT: 2,
          RETURN: ["id", "text", "metadata", "__dist"],
        },
      ) as { documents: Array<{ value: Record<string, string> }> };

      const matches: MemoryMatch[] = [];
      for (const doc of res.documents) {
        const v = doc.value;
        // Cosine distance ∈ [0, 2]; normalize: score = 1 − dist/2
        const dist = parseFloat(v.__dist ?? "2");
        const score = Math.max(0, Math.min(1, 1 - dist / 2));
        if (score < minScore) continue;
        matches.push({
          id: v.id,
          text: v.text,
          score,
          metadata: v.metadata ? (JSON.parse(v.metadata) as Record<string, unknown>) : undefined,
        });
      }

      return matches.sort((a, b) => b.score - a.score);
    } catch (err) {
      throw new MemoryError(`search failed: ${String(err)}`);
    }
  }

  async delete(id: string): Promise<void> {
    try {
      // Scan across all scopes for this instance namespace
      const pattern = `eta:mem:${this.ns}:*:*:${id}`;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for await (const key of (this.client as any).scanIterator({ MATCH: pattern }) as AsyncIterable<string>) {
        await this.client.del(key);
      }
    } catch (err) {
      throw new MemoryError(`delete("${id}") failed: ${String(err)}`);
    }
  }

  async clear(scope: MemoryScope): Promise<void> {
    try {
      const prefix = `eta:mem:${this.ns}:${scope.agentId}:${scope.namespace}:*`;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for await (const key of (this.client as any).scanIterator({ MATCH: prefix }) as AsyncIterable<string>) {
        await this.client.del(key);
      }
    } catch (err) {
      throw new MemoryError(`clear failed: ${String(err)}`);
    }
  }

  /** Release the Redis connection gracefully. */
  async quit(): Promise<void> {
    await this.client.quit();
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async ensureIndex(): Promise<void> {
    if (this.indexReady) return;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (this.client.ft as any).create(
        this.indexName(),
        {
          id: { type: "TEXT", NOSTEM: true },
          agentId: { type: "TAG" },
          scopeNs: { type: "TAG" },
          userId: { type: "TAG" },
          text: { type: "TEXT" },
          vector: {
            type: "VECTOR",
            ALGORITHM: "HNSW",
            TYPE: "FLOAT32",
            DIM: this.vectorDim,
            DISTANCE_METRIC: "COSINE",
          },
        },
        { ON: "HASH", PREFIX: `eta:mem:${this.ns}:` },
      );
    } catch (err: unknown) {
      // "already exists" is expected on reconnect — all other errors are fatal
      if (!String(err).toLowerCase().includes("already")) {
        throw new MemoryError(`ensureIndex failed: ${String(err)}`);
      }
    }
    this.indexReady = true;
  }

  private indexName(): string {
    return `eta:mem:idx:${this.ns}`;
  }

  private entryKey(scope: MemoryScope, id: string): string {
    return `eta:mem:${this.ns}:${scope.agentId}:${scope.namespace}:${id}`;
  }
}
