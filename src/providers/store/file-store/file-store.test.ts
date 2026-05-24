import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileStore } from "./file-store.js";

let baseDir: string;
let store: FileStore;

beforeEach(async () => {
  baseDir = await mkdtemp(join(tmpdir(), "eta-file-store-"));
  store = new FileStore(baseDir);
});

afterEach(async () => {
  await rm(baseDir, { recursive: true, force: true });
});

describe("FileStore", () => {
  describe("read", () => {
    it("returns null on a miss", async () => {
      const result = await store.read("sessions/nonexistent");
      expect(result).toBeNull();
    });
  });

  describe("write / read round-trip", () => {
    it("reads back what was written", async () => {
      const payload = { name: "Alice", score: 42 };
      await store.write("sessions/alice", payload);
      const result = await store.read<typeof payload>("sessions/alice");
      expect(result).toEqual(payload);
    });

    it("overwrites an existing key", async () => {
      await store.write("kv/counter", 1);
      await store.write("kv/counter", 2);
      expect(await store.read("kv/counter")).toBe(2);
    });

    it("handles nested key paths", async () => {
      await store.write("a/b/c", "deep");
      expect(await store.read("a/b/c")).toBe("deep");
    });
  });

  describe("TTL", () => {
    it("returns null for an expired entry", async () => {
      await store.write("cache/item", "value", { ttlMs: 1 });
      await new Promise((r) => setTimeout(r, 10));
      expect(await store.read("cache/item")).toBeNull();
    });

    it("returns value for a non-expired entry", async () => {
      await store.write("cache/fresh", "still-valid", { ttlMs: 5_000 });
      expect(await store.read("cache/fresh")).toBe("still-valid");
    });
  });

  describe("remove", () => {
    it("removes an existing key", async () => {
      await store.write("kv/toDelete", "bye");
      await store.remove("kv/toDelete");
      expect(await store.read("kv/toDelete")).toBeNull();
    });

    it("is idempotent — no error when key is absent", async () => {
      await expect(store.remove("kv/ghost")).resolves.toBeUndefined();
    });
  });

  describe("list", () => {
    it("returns all keys under a prefix", async () => {
      await store.write("sessions/a", 1);
      await store.write("sessions/b", 2);
      await store.write("tokens/x", 3);

      const keys = await store.list("sessions");
      expect(keys.sort()).toEqual(["sessions/a", "sessions/b"]);
    });

    it("returns empty array when prefix has no entries", async () => {
      expect(await store.list("empty")).toEqual([]);
    });

    it("does not include entries from sibling prefixes", async () => {
      await store.write("ns1/key", "a");
      await store.write("ns2/key", "b");
      const keys = await store.list("ns1");
      expect(keys).toEqual(["ns1/key"]);
    });
  });
});

// ---------------------------------------------------------------------------
// Key schema edge cases — 0C characterization
// ---------------------------------------------------------------------------

describe("FileStore — colon-key limitation (0C)", () => {
  it("write with a colon-prefixed key succeeds (stored as a flat file)", async () => {
    // Colon chars in the key do NOT split into directories — the whole segment
    // is treated as a flat filename.  write() should not throw.
    await expect(
      store.write("eta:run:abc", { data: 1 }),
    ).resolves.toBeUndefined();
    const val = await store.read<{ data: number }>("eta:run:abc");
    expect(val?.data).toBe(1);
  });

  it("list() with a colon-prefixed key returns empty — filesystem limitation", async () => {
    // FileStore.list() splits on '/' to resolve a directory, so a colon-keyed
    // prefix like "eta:run:" is treated as a single path segment.  There is no
    // directory named "eta:run:" so readdir returns ENOENT → empty array.
    await store.write("eta:run:abc", { data: 1 });
    await store.write("eta:run:xyz", { data: 2 });

    const keys = await store.list("eta:run:");
    // Documents current behaviour: colon-prefix list returns empty
    expect(keys).toHaveLength(0);
  });

  it("list() with a slash-separated prefix returns keys correctly", async () => {
    // Slash-separated keys create real directory hierarchies that list() can traverse.
    await store.write("eta/run/abc", { data: 1 });
    await store.write("eta/run/xyz", { data: 2 });

    const keys = await store.list("eta/run");
    expect(keys.sort()).toEqual(["eta/run/abc", "eta/run/xyz"]);
  });

  it("kernel colon-prefixed store ops (write/read/remove) are unaffected by the list limitation", async () => {
    // The kernel only calls list() when scanning for keys — internal session
    // and suspend ops only use write/read/remove which work fine with colon keys.
    await store.write("eta:suspend:chk-1", { checkpoint: true });
    const val = await store.read<{ checkpoint: boolean }>("eta:suspend:chk-1");
    expect(val?.checkpoint).toBe(true);

    await store.remove("eta:suspend:chk-1");
    expect(await store.read("eta:suspend:chk-1")).toBeNull();
  });
});
