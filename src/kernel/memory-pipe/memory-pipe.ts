import { nanoid } from "nanoid";
import type {
  MemoryProvider,
  MemoryMatch,
  MemoryScope,
  MemoryKind,
} from "../../contracts/memory.js";
import type { ModelProvider } from "../../contracts/model.js";
import { MEMORY_PIPE_HYDE_SYSTEM_PROMPT } from "../../prompts.js";

// ---------------------------------------------------------------------------
// MemoryPipe — retrieval injection and post-run indexing
// ---------------------------------------------------------------------------

/**
 * MemoryPipe — thin adapter between the kernel and a MemoryProvider.
 *
 * When no provider is configured, `retrieve` returns an empty array and
 * `index` is a no-op (null object pattern).
 *
 * `index()` is fire-and-forget — it never blocks the critical path.
 *
 * When `hypothesize: true` and a `model` is provided, `retrieve()` uses the
 * HyDE technique (Hypothetical Document Embeddings): a short hypothetical
 * answer is generated first, then used as the embedding query instead of the
 * raw user input — improving vector recall quality.
 */
export class MemoryPipe {
  private readonly provider: MemoryProvider | undefined;
  private readonly scope: MemoryScope;
  private readonly model: ModelProvider | undefined;
  private readonly hypothesize: boolean;
  private readonly minScore: number;
  private readonly topK: Partial<Record<MemoryKind, number>> | undefined;
  private readonly budget: number | undefined;

  private constructor(
    provider: MemoryProvider | undefined,
    scope: MemoryScope,
    model?: ModelProvider,
    hypothesize?: boolean,
    minScore?: number,
    topK?: Partial<Record<MemoryKind, number>>,
    budget?: number,
  ) {
    this.provider = provider;
    this.scope = scope;
    this.model = model;
    this.hypothesize = hypothesize ?? false;
    this.minScore = minScore ?? 0;
    this.topK = topK;
    this.budget = budget;
  }

  static create(
    provider: MemoryProvider | undefined,
    scope: MemoryScope,
    model?: ModelProvider,
    hypothesize?: boolean,
    minScore?: number,
    topK?: Partial<Record<MemoryKind, number>>,
    budget?: number,
  ): MemoryPipe {
    return new MemoryPipe(provider, scope, model, hypothesize, minScore, topK, budget);
  }

  /** Fetch memories relevant to `query` before turn 1. */
  async retrieve(query: string): Promise<MemoryMatch[]> {
    if (!this.provider) return [];

    let searchQuery = query;

    // HyDE: generate a hypothetical answer and use it as the search embedding
    if (this.hypothesize && this.model) {
      try {
        const resp = await this.model.complete([
          {
            role: "system",
            content: MEMORY_PIPE_HYDE_SYSTEM_PROMPT,
          },
          { role: "user", content: query },
        ]);
        const text =
          typeof resp.message.content === "string"
            ? resp.message.content.trim()
            : "";
        if (text) searchQuery = text;
      } catch {
        // HyDE failure is non-fatal — fall back to raw query
      }
    }

    let results = await this.provider.search(searchQuery, {
      scope: this.scope,
      minScore: this.minScore,
    });

    // Optional rerank via provider cross-encoder
    if (this.provider.rerank) {
      try {
        results = await this.provider.rerank(results, searchQuery);
      } catch {
        // Rerank failure is non-fatal — fall back to search ordering
      }
    }

    // Kind-aware top-k: for each kind with a configured limit, keep only the
    // top-scoring entries up to that limit (results are already score-ordered)
    if (this.topK) {
      const topK = this.topK;
      const kindCounts: Partial<Record<MemoryKind, number>> = {};
      results = results.filter((m) => {
        const kind = m.kind as MemoryKind | undefined;
        if (kind === undefined) return true;
        const limit = topK[kind];
        if (limit === undefined) return true;
        const count = (kindCounts[kind] ?? 0) + 1;
        kindCounts[kind] = count;
        return count <= limit;
      });
    }

    // Character budget: include entries in score order until budget is reached
    if (this.budget !== undefined) {
      const budget = this.budget;
      let total = 0;
      results = results.filter((m) => {
        const len = m.text.length;
        if (total + len > budget) return false;
        total += len;
        return true;
      });
    }

    return results;
  }

  /**
   * Index typed memory entries after a run completes.
   * Each entry carries a `kind` (`"fact"`, `"user_fact"`, `"summary"`, `"topic"`)
   * that is preserved through the indexing pipeline and returned on retrieval.
   * Fire-and-forget — errors are swallowed and logged, never propagated.
   */
  index(entries: Array<{ text: string; kind: MemoryKind }>): void {
    if (!this.provider || entries.length === 0) return;
    const now = new Date().toISOString();
    void Promise.all(
      entries.map(({ text, kind }) =>
        this.provider!.index({ id: nanoid(), text, kind, scope: this.scope, confidence: 1.0, updatedAt: now }),
      ),
    ).catch((err) => {
      console.error("[eta:kernel] memory index error:", err);
    });
  }
}
