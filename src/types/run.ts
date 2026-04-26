import type { Message, ToolCall } from "./message.js";
import type { ToolCallRecord } from "./tool.js";
import type { TokenUsage } from "../interfaces/model.js";
import type { BudgetConfig, BudgetEvent } from "./budget.js";
import type { HitlConfig } from "./agent.js";
import type { PendingApproval } from "./checkpoint.js";

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
  /** Checkpoint ID — populated when `status === "awaiting_approval"`. Pass to `continueRun()`. */
  checkpointId?: string;
  /** Pending HITL approvals — populated when `status === "awaiting_approval"`. */
  pendingApprovals?: PendingApproval[];
  /** Per-agent sub-results — populated by `AgentRouter.run()`. */
  agentResults?: Record<string, RunResult>;
}

// ---------------------------------------------------------------------------
// Run events — discriminated union on `kind`
// ---------------------------------------------------------------------------

export type RunEvent =
  | TurnStartEvent
  | TurnEndEvent
  | TextDeltaEvent
  | TextDoneEvent
  | ToolCallEvent
  | ToolResultEvent
  | BudgetEvent
  | ErrorEvent
  | CompleteEvent
  | AgentRoutedEvent
  | AgentCompleteEvent;

export interface TurnStartEvent {
  kind: "turn_start";
  turn: number;
}

export interface TurnEndEvent {
  kind: "turn_end";
  turn: number;
  usage: TokenUsage;
}

/**
 * TextDeltaEvent — fired for each incremental text chunk emitted by the model.
 *
 * Callers can use these to stream output progressively (typing indicator, live
 * preview) without setting up SSE transport.  Events fire in order within a turn.
 */
export interface TextDeltaEvent {
  kind: "text_delta";
  /** Incremental text fragment from the model. */
  delta: string;
  turn: number;
}

/**
 * TextDoneEvent — fired once when the model has finished emitting text for a turn.
 *
 * `text` is the full accumulated text for the turn (pre-unmask).
 * Only emitted when the model produced at least one text chunk.
 */
export interface TextDoneEvent {
  kind: "text_done";
  /** Full accumulated text for this turn (before PII unmasking). */
  text: string;
  turn: number;
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

// ---------------------------------------------------------------------------
// Multi-agent orchestration events (emitted by AgentRouter, not the kernel)
// ---------------------------------------------------------------------------

export interface AgentRoutedEvent {
  kind: "agent_routed";
  agentName: string;
  confidence: number;
  reason: string;
}

export interface AgentCompleteEvent {
  kind: "agent_complete";
  agentName: string;
  result: RunResult;
}
