import { nanoid } from "nanoid";
import type { MemoryProvider, MemoryMatch, MemoryScope } from "../../interfaces/memory.js";

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
 */
export class MemoryPipe {
  private readonly provider: MemoryProvider | undefined;
  private readonly scope: MemoryScope;

  private constructor(provider: MemoryProvider | undefined, scope: MemoryScope) {
    this.provider = provider;
    this.scope = scope;
  }

  static create(provider: MemoryProvider | undefined, scope: MemoryScope): MemoryPipe {
    return new MemoryPipe(provider, scope);
  }

  /** Fetch memories relevant to `query` before turn 1. */
  async retrieve(query: string): Promise<MemoryMatch[]> {
    if (!this.provider) return [];
    return this.provider.search(query, { scope: this.scope });
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
