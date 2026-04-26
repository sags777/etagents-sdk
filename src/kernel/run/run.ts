import { nanoid } from "nanoid";
import { buildRunContext } from "../context/context.js";
import { McpHub } from "../mcp-hub/mcp-hub.js";
import { TurnCycle } from "../turn-cycle/turn-cycle.js";
import { persistRun, persistSuspend } from "../persist/persist.js";
import { exitCodeToStatus, createRunServices, buildTurnCycleContext } from "../_shared/_shared.js";
import type { AgentDef } from "../../types/agent.js";
import type { RunConfig, RunResult, RunState, ExitCode } from "../../types/run.js";
import type { SessionSnapshot } from "../../types/session.js";

// ---------------------------------------------------------------------------
// startRun — full kernel entry point
// ---------------------------------------------------------------------------

/**
 * startRun — runs an agent to completion from a single user input.
 *
 * Flow:
 *   1. Build RunContext (runId, merged limits, signal)
 *   2. Connect MCP hub
 *   3. Build ToolRegistry (local + MCP)
 *   4. Create PrivacyFence + MemoryPipe
 *   5. Retrieve memories → inject into system prompt
 *   6. Build initial message list
 *   7. TurnCycle loop until exit condition
 *   8. Persist session snapshot (best-effort)
 *   9. Disconnect MCP hub (always, in finally)
 *  10. Return RunResult
 */
export async function startRun(
  agent: AgentDef,
  input: string,
  config: RunConfig = {},
): Promise<RunResult> {
  const ctx = buildRunContext(agent, config);
  const hub = await McpHub.connect(agent.mcp);

  try {
    const { registry, fence, pipe, emit, ledger } = await createRunServices(agent, hub, config.onEvent);

    // Memory retrieval — inject relevant context into system prompt
    const memories = await pipe.retrieve(input);
    let systemPrompt = agent.systemPrompt;
    if (memories.length > 0) {
      const memCtx = memories.map((m) => m.text).join("\n");
      systemPrompt = `${agent.systemPrompt}\n\nRelevant context:\n${memCtx}`;
    }

    // Initial message list
    const messages = [
      { role: "system" as const, content: systemPrompt },
      { role: "user" as const, content: input },
    ];

    const state: RunState = {
      messages,
      toolCallRecords: [],
      turns: 0,
    };

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
        exitCode = "SUSPEND";
        const checkpointId = nanoid();
        const snapshot = buildSessionSnapshot(ctx.runId, state, ctx.metadata);
        await persistSuspend(
          checkpointId,
          {
            session: snapshot,
            pendingApprovals: result.pendingApprovals,
            suspendedAt: new Date().toISOString(),
          },
          agent.hitl.hitlStore ?? agent.store,
        );
        const suspendResult: RunResult = {
          response: "",
          messages: state.messages,
          toolCalls: state.toolCallRecords,
          turns: state.turns,
          status: "awaiting_approval",
          totalUsage: ledger.state(),
          checkpointId,
          pendingApprovals: result.pendingApprovals,
        };
        emit({ kind: "complete", result: suspendResult });
        return suspendResult;
      }

      // kind === "continue" → loop
    }

    if (exitCode === "COMPLETE" && state.turns >= ctx.maxTurns) {
      exitCode = "MAX_TURNS";
    }

    const status = exitCodeToStatus(exitCode);

    // Persist session snapshot (best-effort)
    try {
      await persistRun(buildSessionSnapshot(ctx.runId, state, ctx.metadata), agent.store);
    } catch {
      // Best-effort — don't fail the run if persistence fails
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
    return runResult;
  } finally {
    await hub.disconnect();
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildSessionSnapshot(
  runId: string,
  state: RunState,
  metadata: Record<string, unknown>,
): SessionSnapshot {
  const now = new Date().toISOString();
  return {
    version: 1,
    runId,
    messages: [...state.messages],
    metadata,
    createdAt: now,
    updatedAt: now,
    __eta: {},
  };
}
