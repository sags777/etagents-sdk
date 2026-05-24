/**
 * @module persist/ports
 *
 * Abstract persistence contracts for kernel run entities.
 * All adapters implement the top-level `PersistenceAdapter` interface
 * and the individual repository interfaces below.
 */

import type {
  RunRecord,
  CheckpointRecord,
  MessageRecord,
  PendingApprovalRecord,
  RoutingDecisionRecord,
  RunEventRecord,
  ToolCallRecordFull,
  AgentPromptRecord,
} from "../../types/records.js";
import type { RunResult } from "../../types/run.js";
import type { Message } from "../../types/message.js";
import type { PendingApproval } from "../../types/checkpoint.js";

// ---------------------------------------------------------------------------
// Individual repository interfaces
// ---------------------------------------------------------------------------

/** Persists and retrieves top-level run records. */
export interface RunRepository {
  save(runId: string, record: RunRecord): Promise<void>;
  load(runId: string): Promise<RunRecord | null>;
  remove(runId: string): Promise<void>;
}

/** Persists and retrieves HITL checkpoint records. */
export interface CheckpointRepository {
  save(checkpointId: string, record: CheckpointRecord): Promise<void>;
  load(checkpointId: string): Promise<CheckpointRecord | null>;
  remove(checkpointId: string): Promise<void>;
}

/**
 * Persists and retrieves the full ordered message history for a run.
 * KV adapters store the entire array as a single blob keyed by `runId`.
 */
export interface MessageRepository {
  saveAll(runId: string, records: MessageRecord[]): Promise<void>;
  loadAll(runId: string): Promise<MessageRecord[]>;
  remove(runId: string): Promise<void>;
}

/**
 * Persists and retrieves pending approval records for a checkpoint.
 * KV adapters store the entire array as a single blob keyed by `checkpointId`.
 */
export interface ApprovalRepository {
  saveAll(
    checkpointId: string,
    records: PendingApprovalRecord[],
  ): Promise<void>;
  loadAll(checkpointId: string): Promise<PendingApprovalRecord[]>;
  remove(checkpointId: string): Promise<void>;
}

/** Persists and retrieves routing decisions made by the AgentRouter. */
export interface RoutingDecisionRepository {
  save(record: RoutingDecisionRecord): Promise<void>;
  load(decisionId: string): Promise<RoutingDecisionRecord | null>;
  remove(decisionId: string): Promise<void>;
}

/**
 * Persists and retrieves tool call records for a run.
 * KV adapters store the entire array as a single blob keyed by `runId`.
 */
export interface ToolCallRepository {
  saveAll(runId: string, records: ToolCallRecordFull[]): Promise<void>;
  loadAll(runId: string): Promise<ToolCallRecordFull[]>;
  remove(runId: string): Promise<void>;
}

/**
 * Persists and retrieves run event records for a run.
 * KV adapters store the entire array as a single blob keyed by `runId`.
 */
export interface RunEventRepository {
  saveAll(runId: string, records: RunEventRecord[]): Promise<void>;
  loadAll(runId: string): Promise<RunEventRecord[]>;
  remove(runId: string): Promise<void>;
}

/**
 * Content-addressed agent prompt store.
 * Deduplicates identical system prompts across agents and runs.
 */
export interface AgentPromptRepository {
  save(record: AgentPromptRecord): Promise<void>;
  load(hash: string): Promise<AgentPromptRecord | null>;
}

// ---------------------------------------------------------------------------
// Domain parameter types for PersistenceAdapter
// ---------------------------------------------------------------------------

/** Parameters for persisting a completed (or aborted) run. */
export interface SaveRunParams {
  runId: string;
  agentId: string;
  agentModelProvider?: string;
  agentModelId?: string;
  result: RunResult;
  messages: readonly Message[];
  metadata: Record<string, unknown>;
  /** ISO-8601 — when this run was originally created. */
  createdAt: string;
  /** Ordered run events to persist (text_delta excluded). */
  events: RunEventRecord[];
  /** The agent's system prompt text (used for content-addressed deduplication). */
  agentSystemPrompt?: string;
}

/** Parameters for persisting a HITL-suspended run. */
export interface SaveSuspendParams {
  runId: string;
  agentId: string;
  agentModelProvider?: string;
  agentModelId?: string;
  checkpointId: string;
  pendingApprovals: PendingApproval[];
  messages: readonly Message[];
  metadata: Record<string, unknown>;
  /** ISO-8601 */
  suspendedAt: string;
  /** Name of the first tool that triggered the suspend, if known. */
  triggerToolName?: string;
  /** ISO-8601 — optional deadline after which this checkpoint should be considered expired. */
  expiresAt?: string;
  /** ISO-8601 — when this run was originally created. */
  createdAt: string;
  /** Turn count at the time of suspend. */
  turns: number;
  /** Ordered run events to persist (text_delta excluded). */
  events: RunEventRecord[];
}

// ---------------------------------------------------------------------------
// Top-level adapter parameter types
// ---------------------------------------------------------------------------

/** Parameters for persisting a routing decision made by AgentRouter. */
export interface SaveRoutingDecisionParams {
  /** Unique ID for this decision, generated by the caller (AgentRouter). */
  decisionId: string;
  strategy: "rule" | "triage";
  inputMessage: string;
  confidence: number;
  reason: string;
  /** Serialisable summary of each assignment (agent name + parallel flag). */
  assignments: Array<{ agentName: string; parallel: boolean }>;
  /** ISO-8601 */
  createdAt: string;
}
