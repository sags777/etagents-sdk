import type { ModelProvider } from "../interfaces/model.js";
import type { MemoryProvider } from "../interfaces/memory.js";
import type { StoreProvider } from "../interfaces/store.js";
import type { PrivacyProvider } from "../interfaces/privacy.js";
import type { ToolDef } from "./tool.js";
import type { Message, ToolCall, ToolResult } from "./message.js";
import type { InsightConfig } from "./insight.js";
import type { McpServerConfig } from "./mcp.js";

// ---------------------------------------------------------------------------
// HITL config
// ---------------------------------------------------------------------------

/**
 * HitlConfig — controls human-in-the-loop approval behaviour.
 *
 * `mode: "none"` disables HITL entirely (default).
 * `mode: "tool"` requires approval before every tool call.
 * `mode: "sensitive"` requires approval only for tools marked `sensitive`.
 */
export interface HitlConfig {
  mode: "none" | "tool" | "sensitive";
  timeoutMs?: number;
  /** Store used to persist pending approvals across process restarts */
  hitlStore?: StoreProvider;
}

// ---------------------------------------------------------------------------
// Lifecycle hooks
// ---------------------------------------------------------------------------

export interface LifecycleHooks {
  onTurnStart?: (turn: number) => void | Promise<void>;
  onTurnEnd?: (turn: number) => void | Promise<void>;
  onToolCall?: (call: ToolCall) => void | Promise<void>;
  onToolResult?: (result: ToolResult) => void | Promise<void>;
  beforeComplete?: (messages: Message[]) => void | Promise<void>;
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
