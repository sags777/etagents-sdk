import { nanoid } from "nanoid";
import type { MemoryProvider, MemoryMatch, MemoryScope } from "../../interfaces/memory.js";
import type { ModelProvider } from "../../interfaces/model.js";

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

  private constructor(
    provider: MemoryProvider | undefined,
    scope: MemoryScope,
    model?: ModelProvider,
    hypothesize?: boolean,
  ) {
    this.provider = provider;
    this.scope = scope;
    this.model = model;
    this.hypothesize = hypothesize ?? false;
  }

  static create(
    provider: MemoryProvider | undefined,
    scope: MemoryScope,
    model?: ModelProvider,
    hypothesize?: boolean,
  ): MemoryPipe {
    return new MemoryPipe(provider, scope, model, hypothesize);
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
            content:
              "Generate a brief, concrete hypothetical answer to the user's question. " +
              "This will be used as a search query to retrieve relevant memory. " +
              "Respond with only the hypothetical answer text, nothing else.",
          },
          { role: "user", content: query },
        ]);
        const text =
          typeof resp.message.content === "string" ? resp.message.content.trim() : "";
        if (text) searchQuery = text;
      } catch {
        // HyDE failure is non-fatal — fall back to raw query
      }
    }

    return this.provider.search(searchQuery, { scope: this.scope });
  }

  /**
   * Index extracted facts after a run completes.
   * Fire-and-forget — errors are swallowed and logged, never propagated.
   */
  index(facts: string[]): void {
    if (!this.provider || facts.length === 0) return;
    void Promise.all(
      facts.map((text) =>
        this.provider!.index({ id: nanoid(), text, scope: this.scope }),
      ),
    ).catch((err) => {
      console.error("[eta:kernel] memory index error:", err);
    });
  }
}
