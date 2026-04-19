/**
 * @module @etagents/sdk/kernel
 *
 * Core runtime — the SDK's IP. Not swappable by design.
 * Orchestrates turn cycles, tool routing, memory, privacy, and persistence.
 */

export { startRun } from "./run/run.js";
export { continueRun } from "./restore/restore.js";
export type { RestoreConfig } from "./restore/restore.js";
export { buildRunContext } from "./context/context.js";
export type { RunContext } from "./context/context.js";
export { MessageQueue } from "./message-queue/message-queue.js";
export { BudgetLedger } from "./budget-ledger/budget-ledger.js";
export { PrivacyFence } from "./privacy-fence/privacy-fence.js";
export { MemoryPipe } from "./memory-pipe/memory-pipe.js";
export { McpHub } from "./mcp-hub/mcp-hub.js";
export { ToolRegistry } from "./tool-registry/tool-registry.js";
export { routeTool } from "./tool-router/tool-router.js";
export { TurnCycle } from "./turn-cycle/turn-cycle.js";
export type { TurnResult, TurnCycleContext } from "./turn-cycle/turn-cycle.js";
export { safeHook } from "./lifecycle/lifecycle.js";
export { persistRun, loadRun, removeRun } from "./persist/persist.js";
