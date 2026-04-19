import type { ExitCode, RunResult, RunEvent } from "../../types/run.js";
import type { AgentDef } from "../../types/agent.js";
import type { RunContext } from "../context/context.js";
import type { TurnCycleContext } from "../turn-cycle/turn-cycle.js";
import type { McpHub } from "../mcp-hub/mcp-hub.js";
import type { MemoryScope } from "../../interfaces/memory.js";
import { ToolRegistry } from "../tool-registry/tool-registry.js";
import { PrivacyFence } from "../privacy-fence/privacy-fence.js";
import { MemoryPipe } from "../memory-pipe/memory-pipe.js";
import { BudgetLedger } from "../budget-ledger/budget-ledger.js";

// ---------------------------------------------------------------------------
// Kernel-private shared utilities
// ---------------------------------------------------------------------------

/**
 * exitCodeToStatus — maps an internal ExitCode to the public RunResult status.
 *
 * Single source of truth — imported by both run.ts and restore.ts.
 */
export function exitCodeToStatus(code: ExitCode): RunResult["status"] {
  const TABLE: Record<ExitCode, RunResult["status"]> = {
    COMPLETE: "complete",
    MAX_TURNS: "complete",
    BUDGET: "budget_exceeded",
    SUSPEND: "awaiting_approval",
    ABORT: "cancelled",
  };
  return TABLE[code];
}

/**
 * createRunServices — builds registry, fence, pipe, emit, and ledger.
 *
 * Shared setup used by both startRun and continueRun.
 */
export async function createRunServices(
  agent: AgentDef,
  hub: McpHub,
  onEvent?: (event: RunEvent) => void,
): Promise<{
  registry: ToolRegistry;
  fence: PrivacyFence;
  pipe: MemoryPipe;
  emit: (event: RunEvent) => void;
  ledger: BudgetLedger;
}> {
  const [registry, fence] = await Promise.all([
    ToolRegistry.build(agent, hub),
    Promise.resolve(PrivacyFence.create(agent.privacy)),
  ]);

  const scope: MemoryScope = { agentId: agent.name, namespace: "default" };
  const pipe = MemoryPipe.create(agent.memory, scope);
  const emit: (event: RunEvent) => void = onEvent ?? (() => undefined);
  const ledger = new BudgetLedger((event) => emit(event));

  return { registry, fence, pipe, emit, ledger };
}

/**
 * buildTurnCycleContext — assembles TurnCycleContext from kernel components.
 *
 * Shared by startRun and continueRun — identical structure in both.
 */
export function buildTurnCycleContext(
  agent: AgentDef,
  registry: ToolRegistry,
  hub: McpHub,
  fence: PrivacyFence,
  ledger: BudgetLedger,
  emit: (event: RunEvent) => void,
  ctx: RunContext,
): TurnCycleContext {
  return {
    model: agent.model,
    registry,
    hub,
    fence,
    ledger,
    hooks: agent.hooks,
    hitl: agent.hitl,
    agentName: agent.name,
    runId: ctx.runId,
    emit,
    signal: ctx.signal,
    maxTokens: ctx.maxTokens,
  };
}
