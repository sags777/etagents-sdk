import type { Message, ToolCall } from "./message.js";
import type { ToolCallRecord } from "./tool.js";
import type { TokenUsage } from "../interfaces/model.js";
import type { BudgetConfig, BudgetEvent } from "./budget.js";
import type { HitlConfig } from "./agent.js";

// ---------------------------------------------------------------------------
// Status + exit codes
// ---------------------------------------------------------------------------

export type RunStatus =
  | "complete"
  | "awaiting_approval"
  | "error"
  | "cancelled"
  | "budget_exceeded";

/**
 * ExitCode — internal reason the turn loop stopped.
 * Distinct from RunStatus so the kernel can map codes to public statuses.
 */
export type ExitCode =
  | "COMPLETE"
  | "MAX_TURNS"
  | "BUDGET"
  | "SUSPEND"
  | "ABORT";

// ---------------------------------------------------------------------------
// Run config
// ---------------------------------------------------------------------------

/**
 * RunConfig — all session-level overrides for a single run.
 * Unset fields fall back to DEFAULT_CONFIG values resolved in the kernel.
 */
export interface RunConfig {
  maxTurns?: number;
  maxTokens?: number;
  budget?: BudgetConfig;
  hitl?: HitlConfig;
  /** ISO-8601 string identifying this run for resumption */
  runId?: string;
  /** Extra metadata attached to the session snapshot */
  metadata?: Record<string, unknown>;
  /** AbortSignal — abort at any await point if signalled */
  signal?: AbortSignal;
  /** Optional event listener — receives RunEvents as they fire */
  onEvent?: (event: RunEvent) => void;
}

// ---------------------------------------------------------------------------
// Run result
// ---------------------------------------------------------------------------

export interface RunResult {
  response: string;
  messages: Message[];
  toolCalls: ToolCallRecord[];
  turns: number;
  status: RunStatus;
  totalUsage?: TokenUsage;
}

// ---------------------------------------------------------------------------
// Run events — discriminated union on `kind`
// ---------------------------------------------------------------------------

export type RunEvent =
  | TurnStartEvent
  | TurnEndEvent
  | ToolCallEvent
  | ToolResultEvent
  | BudgetEvent
  | ErrorEvent
  | CompleteEvent;

export interface TurnStartEvent {
  kind: "turn_start";
  turn: number;
}

export interface TurnEndEvent {
  kind: "turn_end";
  turn: number;
  usage: TokenUsage;
}

export interface ToolCallEvent {
  kind: "tool_call";
  toolCall: ToolCall;
  agentName: string;
}

export interface ToolResultEvent {
  kind: "tool_result";
  toolCallId: string;
  result: string;
  isError: boolean;
  durationMs: number;
}

export interface ErrorEvent {
  kind: "error";
  message: string;
  code: string;
}

export interface CompleteEvent {
  kind: "complete";
  result: RunResult;
}

// ---------------------------------------------------------------------------
// Mutable turn-loop state
// ---------------------------------------------------------------------------

export interface RunState {
  messages: Message[];
  toolCallRecords: ToolCallRecord[];
  turns: number;
}
