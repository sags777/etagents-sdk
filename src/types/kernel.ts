import type { ModelProvider } from "../interfaces/model.js";
import type { StoreProvider } from "../interfaces/store.js";
import type { AgentDef, HitlConfig, LifecycleHooks } from "./agent.js";
import type { RunEvent } from "./run.js";

import type { ToolRegistry } from "../kernel/tool-registry/tool-registry.js";
import type { McpHub } from "../kernel/mcp-hub/mcp-hub.js";
import type { PrivacyFence } from "../kernel/privacy-fence/privacy-fence.js";
import type { BudgetLedger } from "../kernel/budget-ledger/budget-ledger.js";

export interface RunContext {
  readonly agent: AgentDef;
  readonly runId: string;
  readonly maxTurns: number;
  readonly maxTokens: number;
  readonly signal?: AbortSignal;
  readonly metadata: Record<string, unknown>;
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
  runId: string;
  emit: (event: RunEvent) => void;
  signal?: AbortSignal;
  maxTokens: number;
  /** Agent's store — passed through to ToolContext for tool-result caching. */
  store?: StoreProvider;
}