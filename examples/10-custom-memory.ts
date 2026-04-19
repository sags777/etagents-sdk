// examples/10-custom-memory.ts
// ─────────────────────────────────────────────────────────────────────────────
// Implement MemoryProvider to show the full contract, then plug it in.
// Prerequisites: ANTHROPIC_API_KEY in env.
// Run: npx tsx examples/10-custom-memory.ts
// ─────────────────────────────────────────────────────────────────────────────

import { createAgent, startRun } from "../src/index.js";
import type {
  MemoryProvider,
  MemoryEntry,
  MemoryMatch,
  MemorySearchOptions,
  MemoryScope,
} from "../src/index.js";

// ── SimpleMemory — bare-minimum MemoryProvider using keyword scoring ──────────
//
// This is an instructional stub. It stores entries in a plain array and ranks
// results by keyword overlap.  It deliberately omits embeddings so there are
// no infrastructure dependencies.

class SimpleMemory implements MemoryProvider {
  private readonly store = new Map<string, MemoryEntry>();

  // Contract: must not throw
  async index(entry: MemoryEntry): Promise<void> {
    try {
      this.store.set(entry.id, entry);
    } catch {
      // swallow
    }
  }

  async search(query: string, options?: MemorySearchOptions): Promise<MemoryMatch[]> {
    const limit = options?.limit ?? 10;
    const minScore = options?.minScore ?? 0;
    const queryWords = new Set(query.toLowerCase().split(/\W+/).filter((w) => w.length > 2));

    const scored: MemoryMatch[] = [];

    for (const entry of this.store.values()) {
      const entryWords = entry.text.toLowerCase().split(/\W+/).filter((w) => w.length > 2);
      if (entryWords.length === 0) continue;

      const hits = entryWords.filter((w) => queryWords.has(w)).length;
      // Normalise to [0, 1]
      const score = Math.min(hits / Math.max(queryWords.size, 1), 1);

      if (score >= minScore) {
        scored.push({ id: entry.id, text: entry.text, score, metadata: entry.metadata });
      }
    }

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  async delete(id: string): Promise<void> {
    this.store.delete(id);
  }

  async clear(scope: MemoryScope): Promise<void> {
    for (const [id, entry] of this.store) {
      if (
        entry.scope.agentId === scope.agentId &&
        entry.scope.namespace === scope.namespace
      ) {
        this.store.delete(id);
      }
    }
  }
}

// ── Wire it up ───────────────────────────────────────────────────────────────

const memory = new SimpleMemory();

const scope = { agentId: "demo", namespace: "facts" };
await memory.index({ id: "f1", text: "TypeScript is a statically typed superset of JavaScript.", scope });
await memory.index({ id: "f2", text: "Node.js runs JavaScript on the server side.", scope });
await memory.index({ id: "f3", text: "The capital of Japan is Tokyo.", scope });

const agent = createAgent({
  name: "demo",
  systemPrompt: "You are an assistant. Use the context provided to answer questions accurately.",
  model: "claude-sonnet-4-6",
  memory,
});

const result = await startRun(agent, "What do you know about TypeScript?");

console.log("Response:", result.response);
