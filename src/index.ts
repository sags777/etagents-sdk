/**
 * @module @etagents/sdk
 *
 * Model-agnostic agent runtime. Four provider slots (model, memory, store,
 * privacy), a non-swappable kernel, and a plugin CLI.
 *
 * Package: @etagents/sdk
 * CLI binary: eta
 */

// ── Interfaces (provider contracts) ────────────────────────────────

export type {
  ModelProvider,
  ModelMessage,
  MessageRole,
  ContentPart,
  TextPart,
  ImagePart,
  ToolDefinition,
  CompletionOptions,
  ModelResponse,
  FinishReason,
  TokenUsage,
  StreamChunk,
  TextChunk,
  ToolStartChunk,
  ToolDeltaChunk,
  ToolEndChunk,
  FinishChunk,
} from "./interfaces/index.js";

export type {
  MemoryProvider,
  MemoryEntry,
  MemoryScope,
  MemorySearchOptions,
  MemoryMatch,
} from "./interfaces/index.js";

export type { StoreProvider, WriteOptions } from "./interfaces/index.js";

export type {
  PrivacyProvider,
  PrivacyMap,
  MaskResult,
  EncryptedMap,
} from "./interfaces/index.js";

// ── Types (domain types) ───────────────────────────────────────────

export type {
  Role,
  Message,
  ToolCall,
  ToolResult,
} from "./types/index.js";

export type {
  JsonSchema,
  JsonSchemaType,
  ToolDef,
  ToolCallRecord,
} from "./types/index.js";

export type {
  RunStatus,
  ExitCode,
  RunConfig,
  RunResult,
  RunEvent,
  TurnStartEvent,
  TurnEndEvent,
  ToolCallEvent,
  ToolResultEvent,
  ErrorEvent,
  CompleteEvent,
  RunState,
} from "./types/index.js";

export type {
  HitlConfig,
  LifecycleHooks,
  AgentConfig,
  AgentDef,
} from "./types/index.js";

export type { SessionSnapshot, SnapshotMeta } from "./types/index.js";
export type { SuspendSnapshot, PendingApproval, ApprovalDecision } from "./types/index.js";
export type { BudgetConfig, BudgetState, BudgetEvent } from "./types/index.js";
export type { McpServerConfig, McpHandle, McpToolDef } from "./types/index.js";
export type { InsightConfig, InsightResult } from "./types/index.js";

// ── Config + Errors ────────────────────────────────────────────────

export { DEFAULT_CONFIG } from "./config.js";
export type { DefaultConfig } from "./config.js";

export {
  EtaError,
  ModelError,
  StoreError,
  MemoryError,
  PrivacyError,
  ToolError,
  McpError,
  BudgetError,
  CheckpointError,
} from "./errors.js";

// ── Agent API ──────────────────────────────────────────────────────

export { createAgent } from "./agent/index.js";
export { defineTool } from "./agent/index.js";
export type { ToolConfig } from "./agent/index.js";
export { executeTool } from "./agent/index.js";
export type { ToolContext, ToolExecResult } from "./agent/index.js";

// ── Kernel ─────────────────────────────────────────────────────────

export { startRun, continueRun } from "./kernel/index.js";
export type { RunContext } from "./kernel/index.js";
export type { RestoreConfig } from "./kernel/index.js";
export type { TurnResult, TurnCycleContext } from "./kernel/index.js";

// ── Providers (our defaults) ───────────────────────────────────────

export { AnthropicModel } from "./providers/model/index.js";
export type { AnthropicModelConfig } from "./providers/model/index.js";
export { OpenAIModel } from "./providers/model/index.js";
export type { OpenAIModelConfig } from "./providers/model/index.js";
export { AzureModel } from "./providers/model/index.js";
export type { AzureModelConfig } from "./providers/model/index.js";
export { GeminiModel } from "./providers/model/index.js";
export type { GeminiModelConfig } from "./providers/model/index.js";
export { MockModel } from "./providers/model/index.js";
export type { MockResponse, MockToolCall } from "./providers/model/index.js";

export { InMemory } from "./providers/memory/index.js";
export type { InMemoryEmbedder } from "./providers/memory/index.js";
export { RedisMemory } from "./providers/memory/index.js";
export type { RedisMemoryConfig } from "./providers/memory/index.js";

export { FileStore } from "./providers/store/index.js";
export { RedisStore } from "./providers/store/index.js";
export type { RedisStoreConfig } from "./providers/store/index.js";

export { RegexPrivacy } from "./providers/privacy/index.js";
export { BUILTIN_RULES } from "./providers/privacy/index.js";
export type { PiiRule } from "./providers/privacy/index.js";

// ── Orchestration ──────────────────────────────────────────────────

export { AgentRouter } from "./orchestration/index.js";
export { RuleRouter } from "./orchestration/index.js";
export { TriageRouter } from "./orchestration/index.js";
export type { RoutingDecision, RoutingStrategy, RoutingContext } from "./orchestration/index.js";
export type { TriageRouterOptions } from "./orchestration/index.js";

// ── Insight ────────────────────────────────────────────────────────

export { runInsight } from "./insight/index.js";
export { INSIGHT_PROMPTS } from "./insight/index.js";

// ── HTTP / SSE ─────────────────────────────────────────────────────

export { SessionEventStream, SSE_HEADERS } from "./http/index.js";
export type { StreamOptions } from "./http/index.js";
export { SessionEventSource } from "./http/index.js";
export type { ReadyState, SessionEventHandler } from "./http/index.js";
export { toNextHandler } from "./http/index.js";
export type { NextRouteRequest, NextRouteHandler } from "./http/index.js";
export { toExpressHandler } from "./http/index.js";
export type { ExpressRequest, ExpressResponse, ExpressHandler } from "./http/index.js";

// ── MCP ────────────────────────────────────────────────────────────

export { McpClient } from "./mcp/index.js";
export { McpServer } from "./mcp/index.js";
