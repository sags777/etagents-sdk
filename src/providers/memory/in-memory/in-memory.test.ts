import { describe, it, expect } from "vitest";
import { InMemory, type InMemoryEmbedder } from "./in-memory.js";
import type { MemoryEntry, MemoryScope } from "../../../interfaces/memory.js";

const scopeA: MemoryScope = { agentId: "agent-1", namespace: "notes" };
const scopeB: MemoryScope = { agentId: "agent-2", namespace: "notes" };

function mk(id: string, text: string, scope: MemoryScope = scopeA): MemoryEntry {
  return { id, text, scope };
}

/** Trivial embedder: encodes each char as its charCode, padded to fixed length. */
function fakeEmbedder(dim = 8): InMemoryEmbedder {
  return {
    async embed(text: string): Promise<number[]> {
      const vec = new Array<number>(dim).fill(0);
      for (let i = 0; i < Math.min(text.length, dim); i++) {
        vec[i] = text.charCodeAt(i) / 255;
      }
      return vec;
    },
  };
}

describe("InMemory (word-overlap fallback)", () => {
  describe("index + search", () => {
    it("returns an indexed entry matching the query", async () => {
      const mem = new InMemory();
      await mem.index(mk("e1", "user prefers dark mode in the UI settings"));
      const results = await mem.search("dark mode", { scope: scopeA });
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].id).toBe("e1");
    });

    it("returns empty array when store is empty", async () => {
      const mem = new InMemory();
      expect(await mem.search("anything")).toEqual([]);
    });

    it("returns results sorted by descending score", async () => {
      const mem = new InMemory();
      await mem.index(mk("e1", "dark mode toggle preference"));
      await mem.index(mk("e2", "dark mode UI settings dark theme"));
      await mem.index(mk("e3", "light theme only no dark mode here"));
      const results = await mem.search("dark mode");
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
      }
    });

    it("re-indexing same id overwrites the entry", async () => {
      const mem = new InMemory();
      await mem.index(mk("e1", "original text"));
      await mem.index(mk("e1", "updated text about system configuration"));
      const results = await mem.search("system configuration");
      expect(results.find((r) => r.id === "e1")).toBeDefined();
    });
  });

  describe("scope filtering", () => {
    it("excludes entries from a different agentId", async () => {
      const mem = new InMemory();
      await mem.index(mk("e1", "user notification settings", scopeA));
      await mem.index(mk("e2", "user notification settings", scopeB));
      const results = await mem.search("notification settings", {
        scope: { agentId: scopeA.agentId },
      });
      expect(results.every((r) => r.id === "e1")).toBe(true);
      expect(results.some((r) => r.id === "e2")).toBe(false);
    });

    it("returns all matching entries when no scope filter is supplied", async () => {
      const mem = new InMemory();
      await mem.index(mk("e1", "payment method", scopeA));
      await mem.index(mk("e2", "payment method", scopeB));
      const results = await mem.search("payment method");
      expect(results.length).toBe(2);
    });
  });

  describe("score normalisation", () => {
    it("all returned scores are in [0, 1]", async () => {
      const mem = new InMemory();
      await mem.index(mk("e1", "TypeScript strict mode configuration file"));
      await mem.index(mk("e2", "strict TypeScript linting rules eslint"));
      await mem.index(mk("e3", "Python virtual environment setup"));
      const results = await mem.search("strict mode");
      expect(results.length).toBeGreaterThan(0);
      for (const r of results) {
        expect(r.score).toBeGreaterThanOrEqual(0);
        expect(r.score).toBeLessThanOrEqual(1);
      }
    });

    it("respects minScore threshold", async () => {
      const mem = new InMemory();
      await mem.index(mk("e1", "dark mode UI only"));
      await mem.index(mk("e2", "dark mode complete settings theme toggle"));
      const all = await mem.search("dark mode");
      const filtered = await mem.search("dark mode", { minScore: 0.9 });
      expect(filtered.length).toBeLessThanOrEqual(all.length);
      expect(filtered.every((r) => r.score >= 0.9)).toBe(true);
    });
  });

  describe("delete", () => {
    it("removes an entry by id", async () => {
      const mem = new InMemory();
      await mem.index(mk("e1", "temporary note about feature flags"));
      await mem.delete("e1");
      const results = await mem.search("feature flags");
      expect(results.find((r) => r.id === "e1")).toBeUndefined();
    });

    it("is idempotent — no error on missing id", async () => {
      const mem = new InMemory();
      await expect(mem.delete("nonexistent")).resolves.toBeUndefined();
    });
  });

  describe("clear", () => {
    it("removes all entries in the given scope", async () => {
      const mem = new InMemory();
      await mem.index(mk("e1", "memo alpha", scopeA));
      await mem.index(mk("e2", "memo beta", scopeA));
      await mem.index(mk("e3", "memo gamma", scopeB));
      await mem.clear(scopeA);
      const results = await mem.search("memo");
      expect(results.every((r) => r.id === "e3")).toBe(true);
    });

    it("does not affect entries in other scopes", async () => {
      const mem = new InMemory();
      await mem.index(mk("e1", "keep this fact safe", scopeB));
      await mem.clear(scopeA);
      const results = await mem.search("keep this fact", { scope: scopeB });
      expect(results.length).toBe(1);
      expect(results[0].id).toBe("e1");
    });
  });
});

describe("InMemory (cosine similarity with embedder)", () => {
  it("uses vector similarity when embedder is provided", async () => {
    const mem = new InMemory(fakeEmbedder());
    await mem.index(mk("e1", "aaaaaaaa"));
    await mem.index(mk("e2", "zzzzzzzz"));
    // Query similar to "aaaaaaaa" should rank e1 higher
    const results = await mem.search("aaaaaabb");
    expect(results.length).toBe(2);
    expect(results[0].id).toBe("e1");
  });

  it("scores are normalized to [0, 1]", async () => {
    const mem = new InMemory(fakeEmbedder());
    await mem.index(mk("e1", "hello world test"));
    await mem.index(mk("e2", "completely different string"));
    const results = await mem.search("hello world");
    for (const r of results) {
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(1);
    }
  });

  it("respects scope filtering with vectors", async () => {
    const mem = new InMemory(fakeEmbedder());
    await mem.index(mk("e1", "shared text", scopeA));
    await mem.index(mk("e2", "shared text", scopeB));
    const results = await mem.search("shared text", {
      scope: { agentId: scopeA.agentId },
    });
    expect(results.length).toBe(1);
    expect(results[0].id).toBe("e1");
  });
});
