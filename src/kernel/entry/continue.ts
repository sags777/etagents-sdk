import { RunSession } from "../run-session/run-session.js";
import { PersistenceAdapter } from "../persist/persistence-adapter.js";
import type { AgentDef } from "../../types/agent.js";
import type { RunResult, RunEvent } from "../../types/run.js";
import type { ApprovalDecision } from "../../types/checkpoint.js";
import { CheckpointError } from "../../errors.js";

// ---------------------------------------------------------------------------
// RestoreConfig — passed to continueRun by the caller
// ---------------------------------------------------------------------------

export interface RestoreConfig {
  agent: AgentDef;
  signal?: AbortSignal;
  metadata?: Record<string, unknown>;
  onEvent?: (event: RunEvent) => void;
}

// ---------------------------------------------------------------------------
// continueRun — resume a HITL-suspended run
// ---------------------------------------------------------------------------

/**
 * continueRun — loads a `SuspendSnapshot` and resumes the turn loop.
 *
 * Thin wrapper over `RunSession.createForRestore(agent, snapshot, config).resume(...)`.
 * All orchestration logic lives in `RunSession`.
 */
export async function continueRun(
  checkpointId: string,
  decisions: ApprovalDecision[],
  config: RestoreConfig,
): Promise<RunResult> {
  const { agent } = config;
  const store = agent.hitl.hitlStore ?? agent.store;

  const snapshot = await new PersistenceAdapter(store).loadSuspendSnapshot(
    checkpointId,
  );
  if (!snapshot) {
    throw new CheckpointError(
      `No suspend snapshot found for checkpoint "${checkpointId}"`,
    );
  }

  const session = await RunSession.createForRestore(agent, snapshot, {
    signal: config.signal,
    metadata: config.metadata,
    onEvent: config.onEvent,
  });

  return session.resume(checkpointId, decisions);
}
