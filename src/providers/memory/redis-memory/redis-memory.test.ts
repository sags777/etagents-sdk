import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RedisClientType } from "redis";
import { MemoryError } from "../../../lib/errors.js";
import { RedisMemory } from "./redis-memory.js";

interface MockRedisMemoryClient {
  hSet: ReturnType<typeof vi.fn>;
  expire: ReturnType<typeof vi.fn>;
  del: ReturnType<typeof vi.fn>;
  quit: ReturnType<typeof vi.fn>;
  scanIterator: ReturnType<typeof vi.fn>;
  ft: {
    create: ReturnType<typeof vi.fn>;
    search: ReturnType<typeof vi.fn>;
  };
}

function asyncKeys(...keys: string[]): AsyncIterable<string> {
  return {
    async *[Symbol.asyncIterator](): AsyncIterator<string> {
      for (const key of keys) yield key;
    },
  };
}

describe("RedisMemory", () => {
  let client: MockRedisMemoryClient;
  let embedder: { embed(text: string): Promise<number[]> };

  beforeEach(() => {
    client = {
      hSet: vi.fn().mockResolvedValue(1),
      expire: vi.fn().mockResolvedValue(1),
      del: vi.fn().mockResolvedValue(1),
      quit: vi.fn().mockResolvedValue(undefined),
      scanIterator: vi.fn().mockReturnValue(asyncKeys()),
      ft: {
        create: vi.fn().mockResolvedValue(undefined),
        search: vi.fn().mockResolvedValue({ documents: [] }),
      },
    };
    embedder = {
      async embed(_text: string): Promise<number[]> {
        return [0.1, 0.2];
      },
    };
  });

  it("creates the Redis index and stores packed vector entries", async () => {
    const memory = await RedisMemory.connect({
      client: client as unknown as RedisClientType,
      namespace: "sdk",
      embedder,
      vectorDim: 2,
      ttlDays: 1,
    });

    expect(client.ft.create).toHaveBeenCalledWith(
      "eta:mem:idx:sdk",
      expect.objectContaining({
        agentId: { type: "TAG" },
        scopeNs: { type: "TAG" },
        vector: expect.objectContaining({ DIM: 2, TYPE: "FLOAT32" }),
      }),
      { ON: "HASH", PREFIX: "eta:mem:sdk:" },
    );

    await memory.index({
      id: "m1",
      text: "remember this",
      scope: { agentId: "agent-1", namespace: "notes" },
      kind: "fact",
      confidence: 0.8,
      updatedAt: "2026-05-31T00:00:00.000Z",
      metadata: { source: "test" },
    });

    const [key, payload] = client.hSet.mock.calls[0] ?? [];
    expect(key).toBe("eta:mem:sdk:agent-1:notes:m1");
    expect(payload).toMatchObject({
      id: "m1",
      agentId: "agent-1",
      scopeNs: "notes",
      userId: "",
      text: "remember this",
      kind: "fact",
      confidence: "0.8",
      updatedAt: "2026-05-31T00:00:00.000Z",
      metadata: JSON.stringify({ source: "test" }),
      vector: expect.any(Buffer),
    });
    expect(client.expire).toHaveBeenCalledWith(
      "eta:mem:sdk:agent-1:notes:m1",
      86_400,
    );
  });

  it("swallows indexing errors per the memory provider contract", async () => {
    const failingEmbedder = {
      async embed(_text: string): Promise<number[]> {
        throw new Error("embed failure");
      },
    };

    const memory = await RedisMemory.connect({
      client: client as unknown as RedisClientType,
      namespace: "sdk",
      embedder: failingEmbedder,
      vectorDim: 2,
    });

    await expect(
      memory.index({
        id: "m1",
        text: "remember this",
        scope: { agentId: "agent-1", namespace: "notes" },
      }),
    ).resolves.toBeUndefined();
    expect(client.hSet).not.toHaveBeenCalled();
  });

  it("builds scoped KNN searches and maps redis documents into matches", async () => {
    client.ft.search.mockResolvedValue({
      documents: [
        {
          value: {
            id: "m1",
            text: "remember this",
            metadata: JSON.stringify({ source: "test" }),
            kind: "summary",
            confidence: "0.9",
            updatedAt: "2026-05-30T00:00:00.000Z",
            __dist: "0.4",
          },
        },
        {
          value: {
            id: "m2",
            text: "barely related",
            __dist: "1.8",
          },
        },
      ],
    });

    const memory = await RedisMemory.connect({
      client: client as unknown as RedisClientType,
      namespace: "sdk",
      embedder,
      vectorDim: 2,
    });

    await expect(
      memory.search("remember", {
        scope: {
          agentId: "agent-1",
          namespace: "notes",
          userId: "user-1",
        },
        limit: 5,
        minScore: 0.5,
      }),
    ).resolves.toEqual([
      {
        id: "m1",
        text: "remember this",
        score: 0.8,
        kind: "summary",
        confidence: 0.9,
        updatedAt: "2026-05-30T00:00:00.000Z",
        metadata: { source: "test" },
      },
    ]);

    expect(client.ft.search).toHaveBeenCalledWith(
      "eta:mem:idx:sdk",
      "(@agentId:{agent\\-1} @scopeNs:{notes} @userId:{user\\-1})=>[KNN 5 @vector $vec AS __dist]",
      expect.objectContaining({
        PARAMS: { vec: expect.any(Buffer) },
        LIMIT: { from: 0, size: 5 },
        DIALECT: 2,
      }),
    );
  });

  it("scans matching keys for delete and clear operations", async () => {
    client.scanIterator
      .mockReturnValueOnce(asyncKeys("eta:mem:sdk:agent-1:notes:m1"))
      .mockReturnValueOnce(
        asyncKeys(
          "eta:mem:sdk:agent-1:notes:m1",
          "eta:mem:sdk:agent-1:notes:m2",
        ),
      );

    const memory = await RedisMemory.connect({
      client: client as unknown as RedisClientType,
      namespace: "sdk",
      embedder,
      vectorDim: 2,
    });

    await memory.delete("m1");
    expect(client.scanIterator).toHaveBeenNthCalledWith(1, {
      MATCH: "eta:mem:sdk:*:*:m1",
    });

    await memory.clear({ agentId: "agent-1", namespace: "notes" });
    expect(client.scanIterator).toHaveBeenNthCalledWith(2, {
      MATCH: "eta:mem:sdk:agent-1:notes:*",
    });
    expect(client.del).toHaveBeenCalledWith("eta:mem:sdk:agent-1:notes:m1");
    expect(client.del).toHaveBeenCalledWith("eta:mem:sdk:agent-1:notes:m2");
  });

  it("wraps search failures in MemoryError", async () => {
    client.ft.search.mockRejectedValue(new Error("redis down"));

    const memory = await RedisMemory.connect({
      client: client as unknown as RedisClientType,
      namespace: "sdk",
      embedder,
      vectorDim: 2,
    });

    const search = memory.search("remember");
    await expect(search).rejects.toBeInstanceOf(MemoryError);
    await expect(search).rejects.toThrow("search failed");
  });
});