/**
 * @module @etagents/sdk/providers/memory
 *
 * Built-in MemoryProvider implementations. InMemory for local dev; RedisMemory for production.
 */

export { InMemory, type InMemoryEmbedder } from "./in-memory/in-memory.js";
export { RedisMemory, type RedisMemoryConfig } from "./redis-memory/redis-memory.js";
