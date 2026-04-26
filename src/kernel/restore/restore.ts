import { buildRunContext } from "../context/context.js";
import { McpHub } from "../mcp-hub/mcp-hub.js";
import { TurnCycle } from "../turn-cycle/turn-cycle.js";
import { loadSuspend, removeSuspend, persistRun } from "../persist/persist.js";
import { exitCodeToStatus, createRunServices, buildTurnCycleContext, applyDecisions } from "../_shared/_shared.js";
import type { AgentDef } from "../../types/agent.js";
import type { RunResult, RunState, RunEvent, ExitCode } from "../../types/run.js";
import type { ApprovalDecision } from "../../types/checkpoint.js";
import type { ToolContext } from "../../types/tool.js";
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
 * Flow:
 *   1. Load and validate the suspend snapshot
 *   2. Apply approval decisions (execute approved tools, inject rejections)
 *   3. Remove the snapshot from the store
 *   4. Resume the TurnCycle loop to completion
 */
export async function continueRun(
  checkpointId: string,
  decisions: ApprovalDecision[],
  config: RestoreConfig,
): Promise<RunResult> {
  const { agent } = config;
  const store = agent.hitl.hitlStore ?? agent.store;

  const snapshot = await loadSuspend(checkpointId, store);
  if (!snapshot) {
    throw new CheckpointError(
      `No suspend snapshot found for checkpoint "${checkpointId}"`,
    );
  }

  // Validate every pending approval has a matching decision
  const decisionMap = new Map(decisions.map((d) => [d.toolCallId, d]));
  for (const pa of snapshot.pendingApprovals) {
    if (!decisionMap.has(pa.toolCallId)) {
      throw new CheckpointError(
        `Missing decision for tool call "${pa.toolCallId}" (${pa.name})`,
      );
    }
  }

  const ctx = buildRunContext(agent, {
    runId: snapshot.session.runId,
    signal: config.signal,
    metadata: config.metadata ?? snapshot.session.metadata,
  });

  const hub = await McpHub.connect(agent.mcp);

  try {
    const { registry, fence, pipe, emit, ledger } = await createRunServices(agent, hub, config.onEvent);

    // Rebuild state from snapshot
    const state: RunState = {
      messages: [...snapshot.session.messages],
      toolCallRecords: [],
      turns: snapshot.session.messages.filter((m) => m.role === "assistant").length,
    };

    const toolContext: ToolContext = {
      runId: ctx.runId,
      agentName: agent.name,
      messages: state.messages,
    };

    // Apply approval decisions using shared helper
    await applyDecisions(snapshot.pendingApprovals, decisions, state, registry, hub, toolContext);

    // Remove the snapshot — it will be replaced by a new session snapshot
    await removeSuspend(checkpointId, store);

    const tcCtx = buildTurnCycleContext(agent, registry, hub, fence, ledger, emit, ctx);

    const cycle = new TurnCycle();
    let lastResponse = "";
    let exitCode: ExitCode = "COMPLETE";

    while (state.turns < ctx.maxTurns) {
      if (ctx.signal?.aborted) {
        exitCode = "ABORT";
        break;
      }

      const result = await cycle.execute(state, tcCtx);

      if (result.kind === "done") {
        lastResponse = result.response;
        exitCode = "COMPLETE";
        break;
      }

      if (result.kind === "budget") {
        lastResponse = result.lastResponse;
        exitCode = "BUDGET";
        break;
      }

      if (result.kind === "suspend") {
        // Nested suspend not supported — treat as complete with partial response
        exitCode = "SUSPEND";
        break;
      }
    }

    if (exitCode === "COMPLETE" && state.turns >= ctx.maxTurns) {
      exitCode = "MAX_TURNS";
    }

    const status = exitCodeToStatus(exitCode);

    try {
      await persistRun(
        {
          version: 1,
          runId: ctx.runId,
          messages: [...state.messages],
          metadata: ctx.metadata,
          createdAt: snapshot.session.createdAt,
          updatedAt: new Date().toISOString(),
          __eta: {},
        },
        agent.store,
      );
    } catch {
      // Best-effort
    }

    const runResult: RunResult = {
      response: lastResponse,
      messages: state.messages,
      toolCalls: state.toolCallRecords,
      turns: state.turns,
      status,
      totalUsage: ledger.state(),
    };

    emit({ kind: "complete", result: runResult });

    // Index memory facts (fire-and-forget)
    pipe.index([]);

    return runResult;
  } finally {
    await hub.disconnect();
  }
}
