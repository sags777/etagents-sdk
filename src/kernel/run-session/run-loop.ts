import type { RunState, ExitCode, RunEvent } from "../../types/run.js";
import type {
  ApprovalDecision,
  PendingApproval,
} from "../../types/checkpoint.js";
import type { TurnCycleContext } from "../../types/kernel.js";
import type { ToolContext } from "../../types/tool.js";
import type { ToolRegistry } from "../tool-registry/tool-registry.js";
import type { McpHub } from "../mcp-hub/mcp-hub.js";
import type { HitlConfig } from "../../types/agent.js";
import { TurnCycle } from "../turn-cycle/turn-cycle.js";
import { applyDecisions } from "../entry/apply-decisions.js";

// ---------------------------------------------------------------------------
// RunLoopResult
// ---------------------------------------------------------------------------

export interface RunLoopResult {
  lastResponse: string;
  exitCode: ExitCode;
  pendingApprovals?: PendingApproval[];
}

// ---------------------------------------------------------------------------
// RunLoopParams — all dependencies injected; no class coupling
// ---------------------------------------------------------------------------

export interface RunLoopParams {
  state: RunState;
  tcCtx: TurnCycleContext;
  maxTurns: number;
  signal: AbortSignal;
  hitl: HitlConfig;
  registry: ToolRegistry;
  hub: McpHub;
  buildToolContext: (messages: RunState["messages"]) => ToolContext;
}

// ---------------------------------------------------------------------------
// runLoop
// ---------------------------------------------------------------------------

/**
 * runLoop — drives the turn cycle until the model signals completion,
 * a budget or turn limit is hit, the run is aborted, or HITL suspension occurs.
 *
 * Pure function over its parameters — no class coupling, no side-effects
 * beyond `state` mutation (appended messages and tool call records).
 */
export async function runLoop(params: RunLoopParams): Promise<RunLoopResult> {
  const { state, tcCtx, maxTurns, signal, hitl, registry, hub, buildToolContext } = params;
  const cycle = new TurnCycle();
  let lastResponse = "";
  let exitCode: ExitCode = "COMPLETE";

  loop: while (state.turns < maxTurns) {
    if (signal.aborted) {
      exitCode = "ABORT";
      break;
    }

    const result = await cycle.execute(state, tcCtx);

    switch (result.kind) {
      case "done":
        lastResponse = result.response;
        exitCode = "COMPLETE";
        break loop;

      case "budget":
        lastResponse = result.lastResponse;
        exitCode = "BUDGET";
        break loop;

      case "suspend":
        if (hitl.mode === "callback" && hitl.onApprove) {
          const decisions = await hitl.onApprove(result.pendingApprovals);
          await applyDecisions(
            result.pendingApprovals,
            decisions,
            state,
            registry,
            hub,
            buildToolContext(state.messages),
          );
          continue loop;
        }
        // Default suspend — return pending approvals to the caller
        exitCode = "SUSPEND";
        return {
          lastResponse,
          exitCode,
          pendingApprovals: result.pendingApprovals,
        };

      case "continue":
        // loop continues
        break;
    }
  }

  if (exitCode === "COMPLETE" && state.turns >= maxTurns) {
    exitCode = "MAX_TURNS";
  }

  return { lastResponse, exitCode };
}
