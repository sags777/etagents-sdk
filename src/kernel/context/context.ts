import { nanoid } from "nanoid";
import type { AgentDef } from "../../types/agent.js";
import type { RunContext } from "../../types/kernel.js";
import type { RunConfig } from "../../types/run.js";

/**
 * buildRunContext — merges agent defaults with per-run overrides.
 *
 * Generates a fresh `runId` via nanoid unless `config.runId` is supplied
 * (used for session resumption). The returned object is frozen.
 */
export function buildRunContext(agent: AgentDef, config: RunConfig = {}): RunContext {
  return Object.freeze({
    agent,
    runId: config.runId ?? nanoid(),
    maxTurns: config.maxTurns ?? agent.maxTurns,
    maxTokens: config.maxTokens ?? agent.maxTokens,
    signal: config.signal,
    metadata: config.metadata ?? {},
  });
}
