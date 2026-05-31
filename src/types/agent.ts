import type { ModelProvider } from "../contracts/model.js";
import type { MemoryProvider, MemoryKind } from "../contracts/memory.js";
import type { StoreProvider } from "../contracts/store.js";
import type { PrivacyProvider } from "../contracts/privacy.js";
import type { ToolDef } from "./tool.js";
import type { Message, ToolCall, ToolResult } from "./message.js";
import type { InsightConfig } from "./insight.js";
import type { McpServerConfig } from "./mcp.js";
import type { PendingApproval, ApprovalDecision } from "./checkpoint.js";
import type { RunResult } from "./run.js";

// ---------------------------------------------------------------------------
// HITL config
// ---------------------------------------------------------------------------

/**
 * HitlConfig — controls human-in-the-loop approval behaviour.
 *
 * `mode: "none"` disables HITL entirely (default).
 * `mode: "tool"` requires approval before every tool call.
 * `mode: "sensitive"` requires approval only for tools marked `sensitive`.
 * `mode: "callback"` pauses the run, calls `onApprove(pending)`, applies the
 *   returned decisions, and continues — all within the same `startRun()` call.
 *   No checkpoint or store required.
 */
export interface HitlConfig {
  mode: "none" | "tool" | "sensitive" | "callback";
  timeoutMs?: number;
  /** Store used to persist pending approvals across process restarts */
  hitlStore?: StoreProvider;
  /**
   * Synchronous in-process approval handler. Only used when `mode === "callback"`.
   * Receives all pending approvals and must return a decision for each one.
   */
  onApprove?: (pending: PendingApproval[]) => Promise<ApprovalDecision[]>;
}

// ---------------------------------------------------------------------------
// Lifecycle hooks
// ---------------------------------------------------------------------------

/**
 * HookContext — contextual metadata passed to every lifecycle hook.
 *
 * Enables telemetry, logging, and tracing without requiring the hook to
 * capture these values via closure.
 */
export interface HookContext {
  agentName: string;
  runId: string;
  turn: number;
}

export interface LifecycleHooks {
  /**
   * Called before memory retrieval and the first model turn.
   * Errors propagate and abort the run — suitable for critical pre-flight checks.
   */
  beforeRun?: (input: string, context: HookContext) => void | Promise<void>;
  /**
   * Called after the run completes and results are persisted.
   * Errors propagate to the caller — suitable for critical post-run side effects.
   */
  afterRun?: (result: RunResult, context: HookContext) => void | Promise<void>;
  /** Best-effort hook invoked before each model turn. */
  onTurnStart?: (turn: number, context: HookContext) => void | Promise<void>;
  /** Best-effort hook invoked after each model turn. */
  onTurnEnd?: (turn: number, context: HookContext) => void | Promise<void>;
  /** Reserved hook slot — declared but not currently invoked by the runtime. */
  onToolCall?: (call: ToolCall, context: HookContext) => void | Promise<void>;
  /** Best-effort hook invoked after each tool result is produced. */
  onToolResult?: (
    result: ToolResult,
    context: HookContext,
  ) => void | Promise<void>;
  /** Reserved hook slot — declared but not currently invoked by the runtime. */
  beforeComplete?: (
    messages: Message[],
    context: HookContext,
  ) => void | Promise<void>;
}

// ---------------------------------------------------------------------------
// Agent config (user-facing)
// ---------------------------------------------------------------------------

/**
 * AgentConfig — all options the caller can pass to `createAgent()`.
 * Providers that are omitted get no-op defaults inside the kernel.
 */
export interface AgentConfig {
  name: string;
  systemPrompt: string;
  tools?: ToolDef[];

  /** Human-readable description for catalogs, dashboards, and `eta inspect`. */
  description?: string;
  /** Semver string for agent versioning (`"1.0.0"`). No runtime effect. */
  version?: string;

  /** ModelProvider instance or a string shorthand (e.g. `"claude-sonnet-4-6"`) */
  model?: ModelProvider | string;
  memory?: MemoryProvider;
  store?: StoreProvider;
  privacy?: PrivacyProvider;

  insight?: InsightConfig;
  hitl?: HitlConfig;
  hooks?: LifecycleHooks;

  /** MCP servers to connect before the run starts */
  mcp?: McpServerConfig[];

  maxTurns?: number;
  maxTokens?: number;
  /**
   * Retrieval policy for long-term memory injection.
   *
   * Controls how retrieved memories are filtered and budgeted before being
   * appended to the system prompt. All fields are optional — omitting the
   * object entirely applies defaults.
   *
   * @example
   * memoryRetrieval: { minScore: 0.8, topK: { fact: 10, user_fact: 5 }, budget: 2000 }
   */
  memoryRetrieval?: {
    /**
     * Minimum similarity score (0–1) a match must reach to be included.
     * Defaults to `DEFAULT_CONFIG.memoryMinScore`.
     */
    minScore?: number;
    /**
     * Per-kind retrieval limits applied after search and optional reranking.
     * Keys are `MemoryKind` values; values are the maximum number of entries
     * of that kind to include. Unspecified kinds are uncapped.
     */
    topK?: Partial<Record<MemoryKind, number>>;
    /**
     * Maximum total characters of memory text injected into the system prompt.
     * Entries are included in score order until the budget is exhausted.
     */
    budget?: number;
  };
  /**
   * Per-tool output truncation overrides, keyed by tool name.
   * Primarily used to limit large MCP tool outputs (e.g. DOM snapshots) in
   * the message history. Stale copies of a tool's result are compressed to
   * `maxChars` at the start of each new turn; the current turn's result is
   * always sent in full.
   */
  toolTruncation?: Record<string, { maxChars: number; suffix?: string }>;
}

// ---------------------------------------------------------------------------
// AgentDef (resolved, post-createAgent)
// ---------------------------------------------------------------------------

/**
 * AgentDef — the fully-resolved agent object returned by `createAgent()`.
 * All optional provider slots are filled with defaults; callers should treat
 * this as an opaque handle and pass it to `run()`.
 */
export interface AgentDef {
  /** Stable surrogate identity generated by `Agent.build()` — used as FK in persistence records. */
  agentId: string;
  name: string;
  systemPrompt: string;
  /** SHA-256 of `systemPrompt` — content-addresses the prompt for `agent_prompts` entity. */
  systemPromptHash: string;
  /** Resolved model provider name (e.g. `"anthropic"`, `"openai"`, `"gemini"`). */
  modelProvider?: string;
  /** Resolved model ID string (e.g. `"claude-sonnet-4-6"`). */
  modelId?: string;
  tools: ToolDef[];

  /** Human-readable description for catalogs and dashboards. */
  description?: string;
  /** Semver version string. No runtime effect. */
  version?: string;

  model: ModelProvider;
  memory: MemoryProvider;
  store: StoreProvider;
  privacy: PrivacyProvider;

  insight: InsightConfig;
  hitl: HitlConfig;
  hooks: LifecycleHooks;

  mcp: McpServerConfig[];

  maxTurns: number;
  maxTokens: number;
  /**
   * Resolved retrieval policy — `minScore` is always set (default applied in builder).
   * `topK` and `budget` are optional (no cap when absent).
   */
  memoryRetrieval: {
    minScore: number;
    topK?: Partial<Record<MemoryKind, number>>;
    budget?: number;
  };
  /** Per-tool output truncation overrides — see AgentConfig.toolTruncation. */
  toolTruncation?: Record<string, { maxChars: number; suffix?: string }>;
}
