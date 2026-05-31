/**
 * @module records
 *
 * Stable record types for normalized persistence adapters.
 * These are **internal** to the kernel and persistence layer — never re-exported
 * from the public barrel (`src/index.ts`). They describe the entities that a
 * normalized backend (SQL, KV, etc.) would store, distinct from the runtime-only
 * types in the rest of `src/types/`.
 */

import type { RunStatus } from "./run.js";
import type { Role } from "./message.js";

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

/**
 * RunRecord — the top-level record for a single agent run, capturing
 * identity, status, telemetry, and lineage.
 */
export interface RunRecord {
  runId: string;
  agentId: string;
  /** Present when this run was spawned by an AgentRouter from a parent run. */
  parentRunId?: string;
  /** Foreign key to the RoutingDecisionRecord that dispatched this run. */
  routingDecisionId?: string;
  status: RunStatus;
  /** Internal reason the turn loop stopped. */
  exitReason: string;
  turns: number;
  tokensPrompt: number;
  tokensCompletion: number;
  tokensTotal: number;
  /** Wall-clock milliseconds from run start to completion. */
  durationMs?: number;
  /** Milliseconds from run start to first token received from the model. */
  firstTokenMs?: number;
  /** e.g. "anthropic", "openai", "gemini" */
  modelProvider?: string;
  /** e.g. "claude-sonnet-4-6", "gpt-4o" */
  modelId?: string;
  /** Populated when `status === "error"`. */
  errorMessage?: string;
  /** Foreign key to CheckpointRecord when `status === "awaiting_approval"`. */
  checkpointId?: string;
  metadata: Record<string, unknown>;
  /** ISO-8601 timestamp */
  createdAt: string;
  /** ISO-8601 timestamp */
  updatedAt: string;
  /** SHA-256 of the resolved AgentDef config for change detection. */
  configFingerprint?: string;
}

// ---------------------------------------------------------------------------
// Message
// ---------------------------------------------------------------------------

/**
 * MessageRecord — a single message in a run's conversation history,
 * normalised for storage. The `content` field holds the serialised
 * string representation (JSON-encoded for tool roles, plain text for others).
 */
export interface MessageRecord {
  messageId: string;
  runId: string;
  /** 0-based insertion order within the run. */
  seq: number;
  /** 1-based turn number when this message was added, if known. */
  turn?: number;
  role: Role;
  content: string;
  /** Foreign key to the ToolCallRecord when `role === "tool"`. */
  toolCallId?: string;
}

// ---------------------------------------------------------------------------
// Tool calls
// ---------------------------------------------------------------------------

/**
 * ToolCallRecordFull — persistence shape for a single tool invocation.
 * Named `ToolCallRecordFull` to avoid collision with the leaner runtime-only
 * `ToolCallRecord` in `types/tool.ts`.
 */
export interface ToolCallRecordFull {
  toolCallId: string;
  runId: string;
  /** 1-based turn number when this tool call was executed, if known. */
  turn?: number;
  toolName: string;
  args: Record<string, unknown>;
  result?: string;
  isError: boolean;
  /** True when the result was served from the kernel tool-result cache. */
  isFromCache: boolean;
  /** Wall-clock execution time in milliseconds. */
  durationMs?: number;
}

// ---------------------------------------------------------------------------
// Checkpoint / HITL
// ---------------------------------------------------------------------------

/**
 * CheckpointRecord — metadata for a HITL suspend event.
 */
export interface CheckpointRecord {
  checkpointId: string;
  runId: string;
  /** Name of the first tool that triggered the suspend. */
  triggerToolName?: string;
  /** ISO-8601 */
  suspendedAt: string;
  /** ISO-8601 — populated when the checkpoint is resolved. */
  resolvedAt?: string;
  /** ISO-8601 — optional deadline after which unresolved checkpoints expire. */
  expiresAt?: string;
  /** How many times `continueRun` has been called against this checkpoint. */
  resumeAttempts: number;
}

/**
 * PendingApprovalRecord — a single tool call awaiting a human decision,
 * linked to a checkpoint.
 */
export interface PendingApprovalRecord {
  approvalId: string;
  toolCallId: string;
  checkpointId: string;
  agentName: string;
  toolName: string;
  args: Record<string, unknown>;
  /** Explicit state — never rely on NULL to mean "pending". */
  decision: "pending" | "approved" | "rejected";
  /** Who made the decision: a userId, "callback", "system", or "timeout". */
  decidedBy?: string;
  /** ISO-8601 */
  decidedAt?: string;
}

// ---------------------------------------------------------------------------
// Run events
// ---------------------------------------------------------------------------

/**
 * RunEventRecord — a single emitted lifecycle event persisted for audit /
 * replay. High-frequency events such as `text_delta` are typically excluded
 * from persistence (see RunEventSink).
 */
export interface RunEventRecord {
  eventId: string;
  runId: string;
  /** 1-based turn number when the event fired, if applicable. */
  turn?: number;
  /** Matches RunEvent `kind` discriminant. */
  kind: string;
  payload?: Record<string, unknown>;
  /** ISO-8601 */
  occurredAt: string;
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

/**
 * RoutingDecisionRecord — a single routing decision made by an AgentRouter,
 * capturing the strategy used and all agent assignments.
 */
export interface RoutingDecisionRecord {
  decisionId: string;
  strategy: "rule" | "triage";
  inputMessage: string;
  confidence: number;
  reason: string;
  assignments: unknown[];
  /** ISO-8601 */
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Memory
// ---------------------------------------------------------------------------

/**
 * MemoryEntryRecord — a persisted memory fact with provenance and optional
 * embedding metadata for vector search.
 */
export interface MemoryEntryRecord {
  memoryId: string;
  agentId: string;
  namespace: string;
  userId?: string;
  text: string;
  /** Semantic category of this memory entry. */
  kind?: string;
  /** Confidence score in [0, 1] — starts at 1.0, decays over time, boosted on reinforcement. */
  confidence?: number;
  /** e.g. "text-embedding-3-small" */
  embeddingModel?: string;
  /** Dimensionality of the stored embedding vector. */
  embeddingDims?: number;
  /** Run that produced this memory entry. */
  sourceRunId?: string;
  /** Turn within `sourceRunId` when this entry was created. */
  sourceTurn?: number;
  metadata?: Record<string, unknown>;
  /** ISO-8601 — optional expiry for ephemeral memory entries. */
  expiresAt?: string;
  /** ISO-8601 — when this entry was last indexed or reinforced. */
  updatedAt?: string;
  /** ISO-8601 */
  indexedAt: string;
}

// ---------------------------------------------------------------------------
// Run facts (short-term / in-run memory)
// ---------------------------------------------------------------------------

/**
 * RunFactRecord — an extracted fact or summary scoped to a single run,
 * produced by the insight/memory pipe.
 */
export interface RunFactRecord {
  factId: string;
  runId: string;
  kind: "fact" | "user_fact" | "summary" | "topic";
  text: string;
  /** 1-based turn number when this fact was extracted, if known. */
  sourceTurn?: number;
  /** True once this fact has been sent to the memory provider for indexing. */
  isIndexed: boolean;
  /** ISO-8601 — when indexing completed. */
  indexedAt?: string;
  /** Error message if indexing failed. */
  indexError?: string;
}

// ---------------------------------------------------------------------------
// Agent prompts
// ---------------------------------------------------------------------------

/**
 * AgentPromptRecord — content-addressed system prompt.
 * Deduplicates identical prompts across agents and runs; the agents table
 * can reference `hash` as a foreign key.
 */
export interface AgentPromptRecord {
  /** SHA-256 hex digest of `text` — serves as the primary key. */
  hash: string;
  text: string;
  /** ISO-8601 — when this hash was first seen. */
  createdAt: string;
}
