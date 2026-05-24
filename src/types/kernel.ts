import type { ModelProvider } from "../contracts/model.js";
import type { StoreProvider } from "../contracts/store.js";
import type { AgentDef, HitlConfig, LifecycleHooks } from "./agent.js";
import type { RunEvent } from "./run.js";
import type { RunEventRecord } from "./records.js";

import type { ToolRegistry } from "../kernel/tool-registry/tool-registry.js";
import type { McpHub } from "../kernel/mcp-hub/mcp-hub.js";
import type { PrivacyFence } from "../kernel/privacy-fence/privacy-fence.js";
import type { BudgetLedger } from "../kernel/budget-ledger/budget-ledger.js";

// ---------------------------------------------------------------------------
// RunSession types
// ---------------------------------------------------------------------------

/**
 * RunSessionStatus — finite state machine lifecycle states for `RunSession`.
 *
 * Transitions:
 *   IDLE → RUNNING → COMPLETED | ABORTED | ERROR
 *   RUNNING → PAUSED_FOR_INPUT (HITL suspend path)
 *   PAUSED_FOR_INPUT → RUNNING (on resume)
 */
export type RunSessionStatus =
  | "IDLE"
  | "RUNNING"
  | "PAUSED_FOR_INPUT"
  | "ERROR"
  | "COMPLETED"
  | "ABORTED";

/**
 * RunEventSink — abstraction for where emitted RunEvents go.
 *
 * Default sink: fires `onEvent` callback and skips persistence.
 * Normalized-mode sink: additionally persists non-`text_delta` events.
 */
export interface RunEventSink {
  /** Fire the event to the configured listener. */
  emit(event: RunEvent): void;
  /**
   * Persist a structured event record to the store.
   * High-frequency events (text_delta) may be skipped — the sink decides.
   */
  persist(event: RunEventRecord): void;
}

export interface RunContext {
  readonly agent: AgentDef;
  readonly runId: string;
  readonly maxTurns: number;
  readonly maxTokens: number;
  readonly signal?: AbortSignal;
  readonly metadata: Record<string, unknown>;
  /** Routing lineage — set by AgentRouter when dispatching child runs. */
  readonly routingDecisionId?: string;
  /** Routing lineage — runId of the originating parent run, set by AgentRouter. */
  readonly parentRunId?: string;
}

export interface TurnCycleContext {
  model: ModelProvider;
  registry: ToolRegistry;
  hub: McpHub;
  fence: PrivacyFence;
  ledger: BudgetLedger;
  hooks: LifecycleHooks;
  hitl: HitlConfig;
  agentName: string;
  agentId: string;
  runId: string;
  emit: (event: RunEvent) => void;
  signal?: AbortSignal;
  maxTokens: number;
  /** Agent's store — passed through to ToolContext for tool-result caching. */
  store?: StoreProvider;
  /** Run-level metadata (e.g. userId) — passed through to ToolContext. */
  metadata?: Record<string, unknown>;
}
