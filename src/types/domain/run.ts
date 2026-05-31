import type { Message, ToolCall } from "./message.js";
import type { ToolCallRecord } from "./tool.js";
import type { TokenUsage } from "../contracts/model.js";
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
  /**
   * @deprecated Run IDs are always kernel-generated for new runs. Setting this
   * field on a new-run `RunConfig` has no effect. For resumption, the kernel
   * reads the `runId` from the stored snapshot via `continueRun()` automatically.
   */
  runId?: string;
  /** Extra metadata attached to the session snapshot */
  metadata?: Record<string, unknown>;
  /**
   * Routing lineage — set by `AgentRouter` when this run was dispatched as a
   * child of a multi-agent routing decision. Never set by external callers.
   */
  routingDecisionId?: string;
  /**
   * Routing lineage — the `runId` of the originating parent run when dispatched
   * via `AgentRouter`. Never set by external callers.
   */
  parentRunId?: string;
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
  /**
   * Internal reason the turn loop stopped.
   * Distinct from `status` — maps to `ExitCode` values but stored as string
   * for forward-compat with future exit reasons without a breaking type change.
   */
  exitReason?: string;
  /** Wall-clock milliseconds from run start to completion. */
  durationMs?: number;
  /** Milliseconds from run start to first model token received. */
  firstTokenMs?: number;
  /** Populated when `status === "error"` with the caught error message. */
  errorMessage?: string;
  /** Present when this run was spawned by an AgentRouter from a parent run. */
  parentRunId?: string;
  /** Foreign key to the RoutingDecisionRecord that dispatched this run. */
  routingDecisionId?: string;
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
  turn: number;
}

export interface ToolResultEvent {
  kind: "tool_result";
  toolCallId: string;
  result: string;
  isError: boolean;
  isFromCache: boolean;
  durationMs: number;
  turn: number;
}

export interface ErrorEvent {
  kind: "error";
  message: string;
  code: string;
}

/**
 * RunSummary — wire-safe subset of RunResult.
 * Used by completion events so history (messages, toolCalls) never leaves the server.
 * toolCallCount is derived from toolCalls.length at emit time.
 */
export type RunSummary = Omit<
  RunResult,
  "messages" | "toolCalls" | "agentResults"
> & { toolCallCount: number };

export function toRunSummary(result: RunResult): RunSummary {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { messages, toolCalls, agentResults, ...rest } = result;
  return { ...rest, toolCallCount: toolCalls.length };
}

export interface CompleteEvent {
  kind: "complete";
  result: RunSummary;
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
  result: RunSummary;
}
