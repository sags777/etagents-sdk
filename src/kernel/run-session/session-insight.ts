import type { RunState } from "../../types/run.js";
import type { AgentDef } from "../../types/agent.js";
import type { SessionInsights } from "../../types/session.js";
import type { MemoryPipe } from "../memory-pipe/memory-pipe.js";
import { runInsight } from "../../insight/extractor/extractor.js";

// ---------------------------------------------------------------------------
// sessionInsight
// ---------------------------------------------------------------------------

const EMPTY: SessionInsights = { facts: [], userFacts: [], summary: "", topics: [] };

/**
 * sessionInsight — runs the post-turn insight pass and indexes the results
 * into the memory pipe.
 *
 * Wraps `runInsight` (the extractor) with the kernel-level concern of
 * choosing what to index based on `injectSummaryOnly`, and is the single
 * place that bridges extracted insight into the memory provider.
 *
 * Always returns a valid `SessionInsights` — never throws.
 */
export async function sessionInsight(
  state: RunState,
  agent: AgentDef,
  pipe: MemoryPipe,
): Promise<SessionInsights> {
  const insightCfg = agent.insight;
  if (!insightCfg || Object.keys(insightCfg).length === 0) return EMPTY;

  try {
    const result = await runInsight(
      state.messages,
      agent.model,
      insightCfg,
      state.turns,
    );

    const toIndex = insightCfg.injectSummaryOnly
      ? result.summary
        ? [{ text: result.summary, kind: "summary" as const }]
        : []
      : [
          ...result.facts.map((text) => ({ text, kind: "fact" as const })),
          ...result.userFacts.map((text) => ({ text, kind: "user_fact" as const })),
          ...result.topics.map((text) => ({ text, kind: "topic" as const })),
        ];

    pipe.index(toIndex);

    return {
      facts: result.facts,
      userFacts: result.userFacts,
      summary: result.summary,
      topics: result.topics,
    };
  } catch {
    return EMPTY;
  }
}
