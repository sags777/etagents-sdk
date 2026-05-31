import { nanoid } from "nanoid";
import type { AgentDef } from "../../types/domain/agent.js";
import type { RunContext } from "../../types/domain/kernel.js";
import type { RunConfig } from "../../types/domain/run.js";

/**
 * buildRunContext — merges agent defaults with per-run overrides.
 *
 * Always generates a fresh `runId` via nanoid. Caller-supplied `config.runId`
 * is intentionally ignored — caller-supplied IDs on new runs break key
 * uniqueness guarantees. Use `buildRestoreContext` for resumption paths.
 */
export function buildRunContext(
  agent: AgentDef,
  config: RunConfig = {},
): RunContext {
  return Object.freeze({
    agent,
    runId: nanoid(),
    maxTurns: config.maxTurns ?? agent.maxTurns,
    maxTokens: config.maxTokens ?? agent.maxTokens,
    signal: config.signal,
    metadata: config.metadata ?? {},
    routingDecisionId: config.routingDecisionId,
    parentRunId: config.parentRunId,
  });
}

/**
 * buildRestoreContext — builds a `RunContext` for session resumption.
 *
 * Unlike `buildRunContext`, accepts an explicit `runId` sourced from the stored
 * snapshot. Called by the `continueRun` path only — never by `startRun`.
 */
export function buildRestoreContext(
  agent: AgentDef,
  runId: string,
  config: Omit<RunConfig, "runId"> = {},
): RunContext {
  return Object.freeze({
    agent,
    runId,
    maxTurns: config.maxTurns ?? agent.maxTurns,
    maxTokens: config.maxTokens ?? agent.maxTokens,
    signal: config.signal,
    metadata: config.metadata ?? {},
  });
}
