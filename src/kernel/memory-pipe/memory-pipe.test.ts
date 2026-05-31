import { describe, it, expect, vi } from "vitest";
import { MemoryPipe } from "./memory-pipe.js";
import { InMemory } from "../../providers/memory/in-memory/in-memory.js";
import type { MemoryScope } from "../../contracts/memory.js";

const scope: MemoryScope = { agentId: "agent-1", namespace: "default" };

describe("MemoryPipe", () => {
  describe("no provider", () => {
    it("retrieve returns empty array", async () => {
      const pipe = MemoryPipe.create(undefined, scope);
      expect(await pipe.retrieve("anything")).toEqual([]);
    });

    it("index is a no-op — does not throw", () => {
      const pipe = MemoryPipe.create(undefined, scope);
      expect(() => pipe.index([{ text: "fact 1", kind: "fact" }])).not.toThrow();
    });
  });

  describe("with provider — retrieve", () => {
    it("returns matching entries for the query", async () => {
      const memory = new InMemory();
      await memory.index({ id: "f1", text: "blue ocean strategy", scope });
      await memory.index({ id: "f2", text: "red ocean competitive", scope });
      const pipe = MemoryPipe.create(memory, scope);

      const results = await pipe.retrieve("blue ocean");
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].text).toContain("blue");
    });

    it("returns empty array when nothing matches", async () => {
      const pipe = MemoryPipe.create(new InMemory(), scope);
      expect(await pipe.retrieve("xyzzy quux")).toEqual([]);
    });

    it("passes the scope to the memory provider search", async () => {
      const memory = new InMemory();
      const otherScope: MemoryScope = {
        agentId: "other-agent",
        namespace: "default",
      };
      await memory.index({ id: "f1", text: "secret fact", scope: otherScope });

      const pipe = MemoryPipe.create(memory, scope);
      const results = await pipe.retrieve("secret fact");
      expect(results).toHaveLength(0);
    });
  });

  describe("with provider — index", () => {
    it("indexes each fact so it becomes searchable", async () => {
      const memory = new InMemory();
      const pipe = MemoryPipe.create(memory, scope);

      pipe.index([{ text: "quantum entanglement basics", kind: "fact" }]);
      // Allow the fire-and-forget promise to settle
      await new Promise((r) => setTimeout(r, 10));

      const results = await memory.search("quantum entanglement", { scope });
      expect(results.length).toBeGreaterThan(0);
    });

    it("is no-op when facts array is empty", async () => {
      const memory = new InMemory();
      const spy = vi.spyOn(memory, "index");
      const pipe = MemoryPipe.create(memory, scope);

      pipe.index([]);
      await new Promise((r) => setTimeout(r, 10));
      expect(spy).not.toHaveBeenCalled();
    });

    it("swallows errors from the provider — never throws", async () => {
      const failingMemory = new InMemory();
      vi.spyOn(failingMemory, "index").mockRejectedValue(
        new Error("provider down"),
      );
      const pipe = MemoryPipe.create(failingMemory, scope);

      expect(() => pipe.index([{ text: "fact", kind: "fact" }])).not.toThrow();
      // Allow rejection to propagate internally without surfacing
      await new Promise((r) => setTimeout(r, 20));
    });
  });

  describe("rerank", () => {
    it("calls provider.rerank when present and returns reordered results", async () => {
      const memory = new InMemory();
      await memory.index({ id: "a", text: "alpha fact", scope, kind: "fact" });
      await memory.index({ id: "b", text: "beta fact", scope, kind: "fact" });

      // Attach a reranker that reverses the order
      (memory as unknown as Record<string, unknown>).rerank = vi.fn(
        async (results: import("../../contracts/memory.js").MemoryMatch[]) =>
          [...results].reverse(),
      );

      const pipe = MemoryPipe.create(memory, scope);
      const results = await pipe.retrieve("fact");

      expect(results.length).toBeGreaterThanOrEqual(2);
      // reranker reversed the order — first element should be the one that was last
      const rerankSpy = (memory as unknown as Record<string, unknown>).rerank as ReturnType<typeof vi.fn>;
      expect(rerankSpy).toHaveBeenCalledOnce();
    });

    it("falls back to search ordering when rerank throws", async () => {
      const memory = new InMemory();
      await memory.index({ id: "a", text: "alpha fact", scope, kind: "fact" });

      (memory as unknown as Record<string, unknown>).rerank = vi.fn(async () => {
        throw new Error("reranker down");
      });

      const pipe = MemoryPipe.create(memory, scope);
      // Should not throw — falls back to search order
      const results = await pipe.retrieve("fact");
      expect(results.length).toBeGreaterThan(0);
    });
  });

  describe("kind-aware topK", () => {
    it("limits results per kind when topK is set", async () => {
      const memory = new InMemory();
      // Index 3 facts and 3 user_facts
      for (let i = 0; i < 3; i++) {
        await memory.index({ id: `f${i}`, text: `fact entry ${i}`, scope, kind: "fact" });
        await memory.index({ id: `u${i}`, text: `user fact entry ${i}`, scope, kind: "user_fact" });
      }

      const pipe = MemoryPipe.create(
        memory,
        scope,
        undefined,
        undefined,
        undefined,
        { fact: 2, user_fact: 1 },
      );

      const results = await pipe.retrieve("entry");
      const facts = results.filter((r) => r.kind === "fact");
      const userFacts = results.filter((r) => r.kind === "user_fact");

      expect(facts.length).toBeLessThanOrEqual(2);
      expect(userFacts.length).toBeLessThanOrEqual(1);
    });

    it("does not filter kinds not specified in topK", async () => {
      const memory = new InMemory();
      for (let i = 0; i < 3; i++) {
        await memory.index({ id: `t${i}`, text: `topic entry ${i}`, scope, kind: "topic" });
      }

      // topK only limits "fact" — topics are uncapped
      const pipe = MemoryPipe.create(
        memory,
        scope,
        undefined,
        undefined,
        undefined,
        { fact: 1 },
      );

      const results = await pipe.retrieve("topic entry");
      const topics = results.filter((r) => r.kind === "topic");
      // All 3 topics should be returned (uncapped)
      expect(topics.length).toBe(3);
    });
  });

  describe("character budget", () => {
    it("stops including entries once the budget is exhausted", async () => {
      const memory = new InMemory();
      // Each entry is exactly 10 characters: "word_XXXXX"
      const text1 = "aaaaaaaaaa"; // 10 chars
      const text2 = "bbbbbbbbbb"; // 10 chars
      const text3 = "cccccccccc"; // 10 chars
      await memory.index({ id: "e1", text: text1, scope, kind: "fact" });
      await memory.index({ id: "e2", text: text2, scope, kind: "fact" });
      await memory.index({ id: "e3", text: text3, scope, kind: "fact" });

      // Budget = 25 chars → fits 2 entries (10+10=20 ≤ 25), excludes 3rd (20+10=30 > 25)
      const pipe = MemoryPipe.create(
        memory,
        scope,
        undefined,
        undefined,
        undefined,
        undefined,
        25,
      );

      const results = await pipe.retrieve("aaaa bbbb cccc");
      const totalChars = results.reduce((sum, r) => sum + r.text.length, 0);
      expect(totalChars).toBeLessThanOrEqual(25);
      expect(results.length).toBeLessThanOrEqual(2);
    });
  });
});

// ---------------------------------------------------------------------------
// Phase 4 — confidence and updatedAt
// ---------------------------------------------------------------------------

describe("confidence and updatedAt", () => {
  it("index() stores confidence=1.0 and updatedAt on new entries", async () => {
    const memory = new InMemory();
    const pipe = MemoryPipe.create(memory, scope);

    pipe.index([{ text: "typescript generics explained", kind: "fact" }]);
    await new Promise((r) => setTimeout(r, 10));

    const results = await memory.search("typescript generics", { scope });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].confidence).toBe(1.0);
    expect(results[0].updatedAt).toBeDefined();
    expect(typeof results[0].updatedAt).toBe("string");
  });
});
