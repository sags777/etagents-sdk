import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RedisClientType } from "redis";
import { StoreError } from "../../../lib/errors.js";
import { RedisStore, createRedisStore } from "./redis-store.js";

interface MockRedisStoreClient {
  get: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  del: ReturnType<typeof vi.fn>;
  quit: ReturnType<typeof vi.fn>;
  scanIterator: ReturnType<typeof vi.fn>;
}

function asyncKeys(...keys: string[]): AsyncIterable<string> {
  return {
    async *[Symbol.asyncIterator](): AsyncIterator<string> {
      for (const key of keys) yield key;
    },
  };
}

describe("RedisStore", () => {
  let client: MockRedisStoreClient;

  beforeEach(() => {
    client = {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue("OK"),
      del: vi.fn().mockResolvedValue(1),
      quit: vi.fn().mockResolvedValue(undefined),
      scanIterator: vi.fn().mockReturnValue(asyncKeys()),
    };
  });

  it("reads, writes, removes, and lists namespaced keys", async () => {
    client.get.mockResolvedValueOnce(JSON.stringify({ ok: true }));
    client.scanIterator.mockReturnValueOnce(
      asyncKeys("eta:store:sdk:sessions/a", "eta:store:sdk:sessions/b"),
    );

    const store = await RedisStore.connect({
      client: client as unknown as RedisClientType,
      namespace: "sdk",
    });

    await store.write("sessions/a", { ok: true }, { ttlMs: 1_500 });
    expect(client.set).toHaveBeenCalledWith(
      "eta:store:sdk:sessions/a",
      JSON.stringify({ ok: true }),
      { EX: 2 },
    );

    await expect(store.read("sessions/a")).resolves.toEqual({ ok: true });

    await store.remove("sessions/a");
    expect(client.del).toHaveBeenCalledWith("eta:store:sdk:sessions/a");

    await expect(store.list("sessions")).resolves.toEqual([
      "sessions/a",
      "sessions/b",
    ]);
  });

  it("wraps backend errors in StoreError", async () => {
    client.get.mockRejectedValue(new Error("redis down"));

    const store = await RedisStore.connect({
      client: client as unknown as RedisClientType,
      namespace: "sdk",
    });

    const read = store.read("missing");
    await expect(read).rejects.toBeInstanceOf(StoreError);
    await expect(read).rejects.toThrow('read("missing") failed');
  });

  it("lazily connects once in createRedisStore and reuses the connection", async () => {
    const connectedStore = {
      read: vi.fn().mockResolvedValue({ ok: true }),
      write: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
      list: vi.fn().mockResolvedValue(["sessions/a"]),
    };

    const connectSpy = vi
      .spyOn(RedisStore, "connect")
      .mockResolvedValue(connectedStore as unknown as RedisStore);

    const store = createRedisStore({ namespace: "sdk" });

    await expect(store.read("sessions/a")).resolves.toEqual({ ok: true });
    await expect(store.list("sessions")).resolves.toEqual(["sessions/a"]);

    expect(connectSpy).toHaveBeenCalledOnce();
    expect(connectedStore.read).toHaveBeenCalledWith("sessions/a");
    expect(connectedStore.list).toHaveBeenCalledWith("sessions");

    connectSpy.mockRestore();
  });
});