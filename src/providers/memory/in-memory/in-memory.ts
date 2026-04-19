import type {
  MemoryProvider,
  MemoryEntry,
  MemoryScope,
  MemorySearchOptions,
  MemoryMatch,
} from "../../../interfaces/memory.js";

interface StoredEntry extends MemoryEntry {
  indexedAt: number;
  vector?: number[];
}

// ---------------------------------------------------------------------------
// Scoring functions
// ---------------------------------------------------------------------------

/**
 * Cosine similarity in [-1, 1], normalized to [0, 1] for the interface contract.
 * Returns 0 for zero-magnitude vectors.
 */
function cosineSim(a: number[], b: number[]): number {
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  if (denom === 0) return 0;
  // Map cosine [-1, 1] → [0, 1]
  return (dot / denom + 1) / 2;
}

/**
 * Word-overlap score in (0, 1].
 * Splits query into words (>1 char), counts how many appear in target.
 * Returns 0 when no words match — callers should filter these out.
 */
function wordOverlap(query: string, target: string): number {
  const words = query
    .toLowerCase()
    .split(/\W+/)
    .filter((w) => w.length > 1);
  if (words.length === 0) return 0;
  const tLower = target.toLowerCase();
  const unique = new Set(words);
  let hits = 0;
  for (const w of unique) {
    if (tLower.includes(w)) hits++;
  }
  return hits / unique.size;
}

// ---------------------------------------------------------------------------
// Scope helpers
// ---------------------------------------------------------------------------

/** True iff every defined field in `filter` matches the corresponding field of `scope`. */
function scopeSubset(scope: MemoryScope, filter: Partial<MemoryScope>): boolean {
  if (filter.agentId !== undefined && scope.agentId !== filter.agentId) return false;
  if (filter.namespace !== undefined && scope.namespace !== filter.namespace) return false;
  if (filter.userId !== undefined && scope.userId !== filter.userId) return false;
  return true;
}

/** Exact match on all scope fields (userId treated as undefined when absent). */
function scopeEqual(a: MemoryScope, b: MemoryScope): boolean {
  return a.agentId === b.agentId && a.namespace === b.namespace && a.userId === b.userId;
}

// ---------------------------------------------------------------------------
// Embedder interface (optional)
// ---------------------------------------------------------------------------

/** Minimal embedder contract for InMemory vector search. */
export interface InMemoryEmbedder {
  embed(text: string): Promise<number[]>;
}

// ---------------------------------------------------------------------------
// InMemory
// ---------------------------------------------------------------------------

/**
 * InMemory — volatile, in-process MemoryProvider for development and tests.
 *
 * Scoring strategy:
 *   - When an embedder is provided, entries are indexed with vectors and
 *     search uses cosine similarity (normalized to [0, 1]).
 *   - Without an embedder, falls back to word-overlap ratio
 *     (matching query words / total unique query words).
 *
 * No external dependencies beyond the optional embedder.
 */
export class InMemory implements MemoryProvider {
  private readonly store = new Map<string, StoredEntry>();
  private readonly embedder?: InMemoryEmbedder;

  constructor(embedder?: InMemoryEmbedder) {
    this.embedder = embedder;
  }

  async index(entry: MemoryEntry): Promise<void> {
    // Must not throw — per MemoryProvider contract
    try {
      let vector: number[] | undefined;
      if (this.embedder) {
        vector = await this.embedder.embed(entry.text);
      }
      this.store.set(entry.id, { ...entry, indexedAt: Date.now(), vector });
    } catch {
      // Swallow silently
    }
  }

  async search(query: string, options?: MemorySearchOptions): Promise<MemoryMatch[]> {
    const limit = options?.limit ?? 20;
    const minScore = options?.minScore ?? 0;
    const scopeFilter = options?.scope;

    // Get query vector if embedder is available
    let queryVec: number[] | undefined;
    if (this.embedder) {
      try {
        queryVec = await this.embedder.embed(query);
      } catch {
        // Fall back to word-overlap if embedding fails
      }
    }

    const results: MemoryMatch[] = [];

    for (const entry of this.store.values()) {
      if (scopeFilter !== undefined && !scopeSubset(entry.scope, scopeFilter)) continue;

      let score: number;
      if (queryVec && entry.vector) {
        score = cosineSim(queryVec, entry.vector);
      } else {
        score = wordOverlap(query, entry.text);
      }

      if (score > 0 && score >= minScore) {
        results.push({ id: entry.id, text: entry.text, score, metadata: entry.metadata });
      }
    }

    return results.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  async delete(id: string): Promise<void> {
    // Idempotent — no-op when absent
    this.store.delete(id);
  }

  async clear(scope: MemoryScope): Promise<void> {
    for (const [id, entry] of this.store) {
      if (scopeEqual(entry.scope, scope)) {
        this.store.delete(id);
      }
    }
  }
}
