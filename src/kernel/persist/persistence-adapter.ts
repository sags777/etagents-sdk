/**
 * @module persist/persistence-adapter
 *
 * PersistenceAdapter — default persistence implementation.
 *
 * Stores each entity type in its own key space within the configured
 * `StoreProvider`. Arrays (messages, tool calls, events, approvals) are
 * stored as JSON blobs keyed by runId / checkpointId. This is equivalent
 * to individual table rows in a SQL backend — each entity type maps to a
 * distinct prefix rather than being collapsed into a single snapshot blob.
 *
 */

import { nanoid } from "nanoid";
import { createHash } from "node:crypto";
import type { StoreProvider } from "../../contracts/store.js";
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
import type { Message } from "../../types/message.js";
import type { ToolCall } from "../../types/message.js";
import type {
  PendingApproval,
  SuspendSnapshot,
} from "../../types/checkpoint.js";
import type { Role } from "../../types/message.js";
import type {
  RunRepository,
  CheckpointRepository,
  MessageRepository,
  ApprovalRepository,
  RoutingDecisionRepository,
  ToolCallRepository,
  RunEventRepository,
  AgentPromptRepository,
  SaveRunParams,
  SaveSuspendParams,
  SaveRoutingDecisionParams,
} from "./ports.js";
import {
  runRecordKey,
  checkpointRecordKey,
  messagesKey,
  approvalsKey,
  routingDecisionKey,
  toolCallsKey,
  runEventsKey,
  agentPromptKey,
} from "../keys.js";
import { SNAPSHOT_INSIGHTS_KEY } from "../../constants.js";

// ---------------------------------------------------------------------------
// Message serialization helpers
// ---------------------------------------------------------------------------

/**
 * Encode a `Message` into a `MessageRecord`.
 *
 * For assistant messages that carry `toolCalls`, the calls are encoded into
 * the `content` field as `{"__toolCalls":[...],"text":"..."}` so round-trip
 * fidelity is preserved across KV storage without adding a separate column.
 */
function messageToRecord(
  msg: Message,
  runId: string,
  seq: number,
  turn?: number,
): MessageRecord {
  let content = msg.content;
  if (msg.toolCalls && msg.toolCalls.length > 0) {
    content = JSON.stringify({ __toolCalls: msg.toolCalls, text: msg.content });
  }
  return {
    messageId: msg.messageId ?? nanoid(),
    runId,
    seq,
    ...(turn !== undefined ? { turn } : {}),
    role: msg.role as Role,
    content,
    ...(msg.toolCallId !== undefined ? { toolCallId: msg.toolCallId } : {}),
  };
}

function messagesToRecords(
  messages: readonly Message[],
  runId: string,
): MessageRecord[] {
  let currentTurn = 0;
  return [...messages].map((msg, seq) => {
    let turn: number | undefined;
    if (msg.role === "assistant") {
      currentTurn += 1;
      turn = currentTurn;
    } else if (msg.role === "tool" && currentTurn > 0) {
      turn = currentTurn;
    }
    return messageToRecord(msg, runId, seq, turn);
  });
}

/**
 * Decode a `MessageRecord` back into a `Message`.
 *
 * Handles the `__toolCalls` encoding applied by `messageToRecord`.
 */
function recordToMessage(rec: MessageRecord): Message {
  let content = rec.content;
  let toolCalls: ToolCall[] | undefined;

  if (rec.role === "assistant") {
    try {
      const parsed = JSON.parse(rec.content) as {
        __toolCalls?: ToolCall[];
        text?: string;
      };
      if (Array.isArray(parsed.__toolCalls)) {
        toolCalls = parsed.__toolCalls;
        content = parsed.text ?? "";
      }
    } catch {
      // content is plain text — no toolCalls
    }
  }

  return {
    messageId: rec.messageId,
    role: rec.role,
    content,
    ...(toolCalls ? { toolCalls } : {}),
    ...(rec.toolCallId !== undefined ? { toolCallId: rec.toolCallId } : {}),
  };
}

// ---------------------------------------------------------------------------
// Approval conversion helpers
// ---------------------------------------------------------------------------

function pendingToRecord(
  pa: PendingApproval,
  checkpointId: string,
): PendingApprovalRecord {
  return {
    approvalId: nanoid(),
    toolCallId: pa.toolCallId,
    checkpointId,
    agentName: pa.agentName,
    toolName: pa.name,
    args: pa.args,
    decision: "pending",
  };
}

function recordToPending(rec: PendingApprovalRecord): PendingApproval {
  return {
    toolCallId: rec.toolCallId,
    name: rec.toolName,
    args: rec.args,
    agentName: rec.agentName,
  };
}

// ---------------------------------------------------------------------------
// Repository factory helper
// ---------------------------------------------------------------------------

function makeStoreRepo<T>(
  keyFn: (id: string) => string,
  store: StoreProvider,
): {
  save: (id: string, v: T) => Promise<void>;
  load: (id: string) => Promise<T | null>;
  remove: (id: string) => Promise<void>;
} {
  return {
    save: (id, v) => store.write(keyFn(id), v),
    load: (id) => store.read<T>(keyFn(id)),
    remove: (id) => store.remove(keyFn(id)),
  };
}

function makeStoreArrayRepo<T>(
  keyFn: (id: string) => string,
  store: StoreProvider,
): {
  saveAll: (id: string, v: T[]) => Promise<void>;
  loadAll: (id: string) => Promise<T[]>;
  remove: (id: string) => Promise<void>;
} {
  return {
    saveAll: (id, v) => store.write(keyFn(id), v),
    loadAll: async (id) => (await store.read<T[]>(keyFn(id))) ?? [],
    remove: (id) => store.remove(keyFn(id)),
  };
}

// ---------------------------------------------------------------------------
// PersistenceAdapter
// ---------------------------------------------------------------------------

/**
 * PersistenceAdapter — stores each entity type in its own key namespace.
 *
 * All `save*` operations are best-effort from the kernel's perspective: callers
 * in `RunSession` wrap them in try/catch and swallow errors so persistence
 * failures never surface to end users.
 *
 * This is the default adapter wired into `RunSession`.
 */
export class PersistenceAdapter {
  /** @internal */
  readonly runs: RunRepository;
  /** @internal */
  readonly checkpoints: CheckpointRepository;
  /** @internal */
  readonly messages: MessageRepository;
  /** @internal */
  readonly approvals: ApprovalRepository;
  /** @internal */
  readonly routingDecisions: RoutingDecisionRepository;
  /** @internal */
  readonly toolCalls: ToolCallRepository;
  /** @internal */
  readonly runEvents: RunEventRepository;
  /** @internal */
  readonly agentPrompts: AgentPromptRepository;

  constructor(private readonly store: StoreProvider) {
    const s = store;
    this.runs = makeStoreRepo<RunRecord>(runRecordKey, s) as RunRepository;
    this.checkpoints = makeStoreRepo<CheckpointRecord>(
      checkpointRecordKey,
      s,
    ) as CheckpointRepository;
    this.messages = makeStoreArrayRepo<MessageRecord>(
      messagesKey,
      s,
    ) as MessageRepository;
    this.approvals = makeStoreArrayRepo<PendingApprovalRecord>(
      approvalsKey,
      s,
    ) as ApprovalRepository;
    this.routingDecisions = {
      save: (r) => s.write(routingDecisionKey(r.decisionId), r),
      load: (id) => s.read<RoutingDecisionRecord>(routingDecisionKey(id)),
      remove: (id) => s.remove(routingDecisionKey(id)),
    };
    this.toolCalls = makeStoreArrayRepo<ToolCallRecordFull>(
      toolCallsKey,
      s,
    ) as ToolCallRepository;
    this.runEvents = makeStoreArrayRepo<RunEventRecord>(
      runEventsKey,
      s,
    ) as RunEventRepository;
    this.agentPrompts = {
      save: (r) => s.write(agentPromptKey(r.hash), r),
      load: (hash) => s.read<AgentPromptRecord>(agentPromptKey(hash)),
    };
  }

  // ---------------------------------------------------------------------------
  // PersistenceAdapter implementation
  // ---------------------------------------------------------------------------

  async saveCompletedRun(params: SaveRunParams): Promise<void> {
    const now = new Date().toISOString();
    const { result } = params;

    const metadata: Record<string, unknown> = { ...params.metadata };
    if (params.insights) {
      metadata[SNAPSHOT_INSIGHTS_KEY] = params.insights;
    }

    const runRecord: RunRecord = {
      runId: params.runId,
      agentId: params.agentId,
      parentRunId: result.parentRunId,
      routingDecisionId: result.routingDecisionId,
      status: result.status,
      exitReason: result.exitReason ?? "COMPLETE",
      turns: result.turns,
      tokensPrompt: result.totalUsage?.prompt ?? 0,
      tokensCompletion: result.totalUsage?.completion ?? 0,
      tokensTotal: result.totalUsage?.total ?? 0,
      durationMs: result.durationMs,
      firstTokenMs: result.firstTokenMs,
      modelProvider: params.agentModelProvider,
      modelId: params.agentModelId,
      errorMessage: result.errorMessage,
      checkpointId: result.checkpointId,
      metadata,
      createdAt: params.createdAt,
      updatedAt: now,
    };

    const messageRecords = messagesToRecords(params.messages, params.runId);

    const toolCallRecords: ToolCallRecordFull[] = (result.toolCalls ?? []).map(
      (tc) => ({
        toolCallId: tc.id,
        runId: params.runId,
        turn: tc.turn,
        toolName: tc.name,
        args: tc.args,
        result: tc.result,
        isError: tc.isError,
        isFromCache: tc.isFromCache ?? false,
        durationMs: tc.durationMs,
      }),
    );

    const writes: Promise<void>[] = [
      this.runs.save(runRecord.runId, runRecord),
      this.messages.saveAll(params.runId, messageRecords),
    ];

    if (toolCallRecords.length > 0) {
      writes.push(this.toolCalls.saveAll(params.runId, toolCallRecords));
    }

    if (params.events.length > 0) {
      writes.push(this.runEvents.saveAll(params.runId, params.events));
    }

    await Promise.all(writes);

    // Best-effort content-addressed prompt dedup (independent write)
    if (params.agentSystemPrompt) {
      await this.saveAgentPrompt(params.agentSystemPrompt).catch(
        () => undefined,
      );
    }
  }

  async saveSuspendedRun(params: SaveSuspendParams): Promise<void> {
    const now = new Date().toISOString();

    const runRecord: RunRecord = {
      runId: params.runId,
      agentId: params.agentId,
      status: "awaiting_approval",
      exitReason: "SUSPEND",
      turns: params.turns,
      tokensPrompt: 0,
      tokensCompletion: 0,
      tokensTotal: 0,
      modelProvider: params.agentModelProvider,
      modelId: params.agentModelId,
      checkpointId: params.checkpointId,
      metadata: params.metadata,
      createdAt: params.createdAt,
      updatedAt: now,
    };

    const checkpointRecord: CheckpointRecord = {
      checkpointId: params.checkpointId,
      runId: params.runId,
      triggerToolName: params.triggerToolName,
      suspendedAt: params.suspendedAt,
      resumeAttempts: 0,
      expiresAt: params.expiresAt,
    };

    const messageRecords = messagesToRecords(params.messages, params.runId);

    const approvalRecords = params.pendingApprovals.map((pa) =>
      pendingToRecord(pa, params.checkpointId),
    );

    const writes: Promise<void>[] = [
      this.runs.save(runRecord.runId, runRecord),
      this.checkpoints.save(checkpointRecord.checkpointId, checkpointRecord),
      this.messages.saveAll(params.runId, messageRecords),
      this.approvals.saveAll(params.checkpointId, approvalRecords),
    ];

    if (params.events.length > 0) {
      writes.push(this.runEvents.saveAll(params.runId, params.events));
    }

    await Promise.all(writes);
  }

  async loadSuspendSnapshot(
    checkpointId: string,
  ): Promise<SuspendSnapshot | null> {
    const checkpoint = await this.checkpoints.load(checkpointId);
    if (!checkpoint) return null;

    const [messageRecords, approvalRecords] = await Promise.all([
      this.messages.loadAll(checkpoint.runId),
      this.approvals.loadAll(checkpointId),
    ]);

    const messages = messageRecords
      .sort((a, b) => a.seq - b.seq)
      .map(recordToMessage);

    const now = new Date().toISOString();
    return {
      session: {
        version: 1,
        runId: checkpoint.runId,
        messages,
        metadata: {},
        createdAt: checkpoint.suspendedAt,
        updatedAt: now,
        insights: { facts: [], userFacts: [], summary: "", topics: [] },
        _kernel: {},
      },
      pendingApprovals: approvalRecords.map(recordToPending),
      suspendedAt: checkpoint.suspendedAt,
      triggerToolName: checkpoint.triggerToolName,
      expiresAt: checkpoint.expiresAt,
      resumeAttempts: checkpoint.resumeAttempts,
    };
  }

  async removeSuspendedRun(checkpointId: string): Promise<void> {
    const checkpoint = await this.checkpoints.load(checkpointId);
    if (!checkpoint) return;

    // Only the checkpoint record is removed; approval records are kept as an
    // audit trail (keyed by checkpointId, linked via PendingApprovalRecord.checkpointId).
    await this.checkpoints.remove(checkpointId);
  }

  /**
   * Persist a routing decision record made by `AgentRouter`.
   *
   * Best-effort from the caller's perspective — wrapping in try/catch is
   * recommended so persistence failures never block routing fan-out.
   */
  async saveRoutingDecision(params: SaveRoutingDecisionParams): Promise<void> {
    const record: RoutingDecisionRecord = {
      decisionId: params.decisionId,
      strategy: params.strategy,
      inputMessage: params.inputMessage,
      confidence: params.confidence,
      reason: params.reason,
      assignments: params.assignments,
      createdAt: params.createdAt,
    };
    await this.routingDecisions.save(record);
  }

  /**
   * Update pending approval records to their final resolved state.
   *
   * Loads the existing records for `checkpointId`, applies the decision from
   * `ApprovalDecision[]` to each matching record, and re-saves the array.
   * Records that have no matching decision retain their current state.
   *
   * @param checkpointId  The checkpoint whose approvals should be updated.
   * @param decisions     Array of `{ toolCallId, approved }` verdicts.
   * @param decidedBy     Who made the decision: a userId, "callback", "system", or "timeout".
   * @param decidedAt     ISO-8601 timestamp of the decision.
   */
  async resolveApprovals(
    checkpointId: string,
    decisions: ReadonlyArray<{ toolCallId: string; approved: boolean }>,
    decidedBy: string,
    decidedAt: string,
  ): Promise<void> {
    const records = await this.approvals.loadAll(checkpointId);
    if (records.length === 0) return;

    const decisionMap = new Map(decisions.map((d) => [d.toolCallId, d]));
    const updated = records.map((r): PendingApprovalRecord => {
      const decision = decisionMap.get(r.toolCallId);
      if (!decision) return r;
      return {
        ...r,
        decision: decision.approved ? "approved" : "rejected",
        decidedBy,
        decidedAt,
      };
    });
    await this.approvals.saveAll(checkpointId, updated);
  }

  /**
   * Increment `resumeAttempts` on a checkpoint record and optionally set
   * `resolvedAt`. Used by `RunSession.resume()` to track each resolution
   * attempt against a suspended checkpoint.
   *
   * No-ops silently if the checkpoint no longer exists.
   *
   * @param checkpointId  The checkpoint to update.
   * @param resolvedAt    Optional ISO-8601 timestamp to mark resolution.
   */
  async incrementResumeAttempts(
    checkpointId: string,
    resolvedAt?: string,
  ): Promise<void> {
    const record = await this.checkpoints.load(checkpointId);
    if (!record) return;
    const updated: CheckpointRecord = {
      ...record,
      resumeAttempts: record.resumeAttempts + 1,
      ...(resolvedAt !== undefined ? { resolvedAt } : {}),
    };
    await this.checkpoints.save(checkpointId, updated);
  }

  /**
   * Content-addressed upsert for a system prompt.
   *
   * Computes the SHA-256 hash of `text` and writes an `AgentPromptRecord`
   * only if the hash key does not yet exist. Idempotent — safe to call on
   * every run; identical prompts are stored exactly once.
   */
  async saveAgentPrompt(text: string): Promise<void> {
    if (!text) return;
    const hash = createHash("sha256").update(text).digest("hex");
    const existing = await this.agentPrompts.load(hash);
    if (existing) return;
    const record: AgentPromptRecord = {
      hash,
      text,
      createdAt: new Date().toISOString(),
    };
    await this.agentPrompts.save(record);
  }
}
