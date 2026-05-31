/**
 * Key builder helpers — single source of truth for every store key the kernel
 * constructs. Import these rather than building key strings inline.
 *
 * FileStore resolves keys using `/` as a path separator, so all keys produced
 * here use `/` as the namespace delimiter. The STORE_KEYS prefixes use `:` as
 * the human-readable separator; these builders convert to `/` for FileStore
 * compatibility while keeping the logical prefix clear.
 */

import { STORE_KEYS } from "../lib/constants.js";
import crypto from "node:crypto";

export const runKey = (runId: string): string =>
  `${STORE_KEYS.SESSION_PREFIX}${runId}`;

export const suspendKey = (checkpointId: string): string =>
  `${STORE_KEYS.SUSPEND_PREFIX}${checkpointId}`;

/**
 * Tool cache key — scoped by agentId so two agents with identically named
 * tools never share a cache entry. Uses SHA-256 of sorted-key JSON to bound
 * key length and prevent encoding collisions. All callers must pass the
 * agent's stable id.
 */
export const toolCacheKey = (
  agentId: string,
  toolName: string,
  args: Record<string, unknown>,
): string => {
  const stable = JSON.stringify(args, Object.keys(args).sort());
  const hash = crypto.createHash("sha256").update(stable).digest("base64url");
  return `${STORE_KEYS.TOOL_CACHE_PREFIX}${agentId}:${toolName}:${hash}`;
};

export const memoryKey = (
  namespace: string,
  agentId: string,
  scopeNs: string,
  id: string,
): string =>
  `${STORE_KEYS.MEMORY_PREFIX}${namespace}:${agentId}:${scopeNs}:${id}`;

export const storeKey = (namespace: string, key: string): string =>
  `${STORE_KEYS.STORE_PREFIX}${namespace}:${key}`;

// ---------------------------------------------------------------------------
// Normalized entity keys
// ---------------------------------------------------------------------------

/** Key for a normalized RunRecord (distinct from blob SESSION_PREFIX). */
export const runRecordKey = (runId: string): string =>
  `${STORE_KEYS.RUN_RECORD_PREFIX}${runId}`;

/** Key for a normalized CheckpointRecord. */
export const checkpointRecordKey = (checkpointId: string): string =>
  `${STORE_KEYS.CHECKPOINT_PREFIX}${checkpointId}`;

/** Key for the MessageRecord[] array for a run. */
export const messagesKey = (runId: string): string =>
  `${STORE_KEYS.MESSAGES_PREFIX}${runId}`;

/** Key for the PendingApprovalRecord[] array for a checkpoint. */
export const approvalsKey = (checkpointId: string): string =>
  `${STORE_KEYS.APPROVALS_PREFIX}${checkpointId}`;

/** Key for a RoutingDecisionRecord. */
export const routingDecisionKey = (decisionId: string): string =>
  `${STORE_KEYS.ROUTING_DECISION_PREFIX}${decisionId}`;

/** Key for the ToolCallRecordFull[] array for a run. */
export const toolCallsKey = (runId: string): string =>
  `${STORE_KEYS.TOOL_CALLS_PREFIX}${runId}`;

/** Key for the RunEventRecord[] array for a run. */
export const runEventsKey = (runId: string): string =>
  `${STORE_KEYS.RUN_EVENTS_PREFIX}${runId}`;

/** Key for an AgentPromptRecord keyed by prompt hash. */
export const agentPromptKey = (hash: string): string =>
  `${STORE_KEYS.AGENT_PROMPT_PREFIX}${hash}`;
