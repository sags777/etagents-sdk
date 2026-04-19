/**
 * @module @etagents/sdk/types
 *
 * Kernel-internal domain types shaped for the runtime, not for provider implementors.
 */

export type { Role, Message, ToolCall, ToolResult } from "./message.js";

export type {
  JsonSchema,
  JsonSchemaType,
  ToolDef,
  ToolCallRecord,
} from "./tool.js";

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
} from "./run.js";

export type {
  HitlConfig,
  LifecycleHooks,
  AgentConfig,
  AgentDef,
} from "./agent.js";

export type {
  SessionSnapshot,
  SnapshotMeta,
} from "./session.js";

export type {
  SuspendSnapshot,
  PendingApproval,
  ApprovalDecision,
} from "./checkpoint.js";

export type {
  BudgetConfig,
  BudgetState,
  BudgetEvent,
} from "./budget.js";

export type {
  McpServerConfig,
  StdioMcpServerConfig,
  SseMcpServerConfig,
  McpHandle,
  McpToolDef,
} from "./mcp.js";

export type { InsightConfig, InsightResult } from "./insight.js";
