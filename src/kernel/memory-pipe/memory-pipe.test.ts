import { describe, it, expect, vi } from "vitest";
import { MemoryPipe } from "./memory-pipe.js";
import { InMemory } from "../../providers/memory/in-memory/in-memory.js";
import type { MemoryScope } from "../../interfaces/memory.js";

const scope: MemoryScope = { agentId: "agent-1", namespace: "default" };

describe("MemoryPipe", () => {
  describe("no provider", () => {
    it("retrieve returns empty array", async () => {
      const pipe = MemoryPipe.create(undefined, scope);
      expect(await pipe.retrieve("anything")).toEqual([]);
    });

    it("index is a no-op — does not throw", () => {
      const pipe = MemoryPipe.create(undefined, scope);
      expect(() => pipe.index(["fact 1"])).not.toThrow();
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
      const otherScope: MemoryScope = { agentId: "other-agent", namespace: "default" };
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

      pipe.index(["quantum entanglement basics"]);
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
      vi.spyOn(failingMemory, "index").mockRejectedValue(new Error("provider down"));
      const pipe = MemoryPipe.create(failingMemory, scope);

      expect(() => pipe.index(["fact"])).not.toThrow();
      // Allow rejection to propagate internally without surfacing
      await new Promise((r) => setTimeout(r, 20));
    });
  });
});
