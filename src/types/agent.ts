import type { ModelProvider } from "../interfaces/model.js";
import type { MemoryProvider } from "../interfaces/memory.js";
import type { StoreProvider } from "../interfaces/store.js";
import type { PrivacyProvider } from "../interfaces/privacy.js";
import type { ToolDef } from "./tool.js";
import type { Message, ToolCall, ToolResult } from "./message.js";
import type { InsightConfig } from "./insight.js";
import type { McpServerConfig } from "./mcp.js";
import type { PendingApproval, ApprovalDecision } from "./checkpoint.js";

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
  onTurnStart?: (turn: number, context: HookContext) => void | Promise<void>;
  onTurnEnd?: (turn: number, context: HookContext) => void | Promise<void>;
  onToolCall?: (call: ToolCall, context: HookContext) => void | Promise<void>;
  onToolResult?: (result: ToolResult, context: HookContext) => void | Promise<void>;
  beforeComplete?: (messages: Message[], context: HookContext) => void | Promise<void>;
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
  name: string;
  systemPrompt: string;
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
}
