import { nanoid } from "nanoid";
import { DEFAULT_HITL_TIMEOUT } from "../../constants.js";
import type { AgentDef } from "../../types/agent.js";
import type {
  RunConfig,
  RunResult,
  RunState,
  ExitCode,
  RunEvent,
} from "../../types/run.js";
import type {
  ApprovalDecision,
  SuspendSnapshot,
} from "../../types/checkpoint.js";
import type { Message } from "../../types/message.js";
import type { ToolContext } from "../../types/tool.js";
import type { SessionInsights } from "../../types/session.js";
import type { RunContext, RunSessionStatus } from "../../types/kernel.js";
import type { MemoryScope } from "../../contracts/memory.js";
import type { RunEventRecord } from "../../types/records.js";
import { buildRunContext, buildRestoreContext } from "./context.js";
import { McpHub } from "../mcp-hub/mcp-hub.js";
import { ToolRegistry } from "../tool-registry/tool-registry.js";
import { PrivacyFence } from "../privacy-fence/privacy-fence.js";
import { MemoryPipe } from "../memory-pipe/memory-pipe.js";
import { BudgetLedger } from "../budget-ledger/budget-ledger.js";
import { PersistenceAdapter } from "../persist/persistence-adapter.js";
import { exitCodeToStatus } from "./exit-code.js";
import { runLoop } from "./run-loop.js";
import { sessionInsight } from "./session-insight.js";
import { applyDecisions } from "../entry/apply-decisions.js";
import { toRunSummary } from "../../types/run.js";
import { CheckpointError } from "../../errors.js";

// ---------------------------------------------------------------------------
// RunSession
// ---------------------------------------------------------------------------

/**
 * RunSession — encapsulates the full execution pipeline for a single agent run.
 *
 * Manages the explicit finite-state lifecycle:
 *   `IDLE` → `RUNNING` → `COMPLETED | ABORTED | ERROR`
 *   `RUNNING` → `PAUSED_FOR_INPUT` (HITL suspend path)
 *
 * Owns the MCP hub connection and all runtime service instances.
 * Single-use: each `run()` or `resume()` call transitions from `IDLE`; the
 * session cannot be restarted after it reaches a terminal state.
 *
 * Typically accessed via the `startRun` / `continueRun` public-API wrappers.
 * Construct directly only for advanced use cases that need per-session access
 * to lifecycle state, telemetry, or programmatic abort.
 */
export class RunSession {
  private lifecycleStatus: RunSessionStatus = "IDLE";
  private messageLog: readonly Message[] = [];
  private startTimeMs = 0;
  private firstTokenMs: number | undefined;
  private eventLog: RunEventRecord[] = [];

  private readonly controller: AbortController;
  private readonly suspendSnapshot: SuspendSnapshot | undefined;
  private readonly adapter: PersistenceAdapter;
  private readonly createdAt: string;

  private constructor(
    private readonly agent: AgentDef,
    private readonly ctx: RunContext,
    private readonly fence: PrivacyFence,
    private readonly ledger: BudgetLedger,
    private readonly pipe: MemoryPipe,
    private readonly registry: ToolRegistry,
    private readonly hub: McpHub,
    private readonly emitRaw: (event: RunEvent) => void,
    controller: AbortController,
    suspendSnapshot?: SuspendSnapshot,
    adapter?: PersistenceAdapter,
  ) {
    this.controller = controller;
    this.suspendSnapshot = suspendSnapshot;
    this.adapter = adapter ?? new PersistenceAdapter(agent.store);
    this.createdAt = new Date().toISOString();
  }

  // ---------------------------------------------------------------------------
  // Factories
  // ---------------------------------------------------------------------------

  /**
   * Factory for new runs — always generates a fresh `runId` via `buildRunContext`.
   * Connects the MCP hub and builds all runtime services before returning.
   */
  static async create(
    agent: AgentDef,
    config: RunConfig = {},
  ): Promise<RunSession> {
    const ctx = buildRunContext(agent, config);
    return RunSession.buildSession(agent, ctx, config.onEvent);
  }

  /**
   * Factory for session restoration — uses the `runId` from `snapshot.session`.
   * The suspend snapshot must be loaded by the caller before constructing.
   */
  static async createForRestore(
    agent: AgentDef,
    snapshot: SuspendSnapshot,
    config: Omit<RunConfig, "runId"> & {
      onEvent?: (event: RunEvent) => void;
    } = {},
  ): Promise<RunSession> {
    const ctx = buildRestoreContext(agent, snapshot.session.runId, config);
    return RunSession.buildSession(agent, ctx, config.onEvent, snapshot);
  }

  private static async buildSession(
    agent: AgentDef,
    ctx: RunContext,
    onEvent?: (event: RunEvent) => void,
    suspendSnapshot?: SuspendSnapshot,
  ): Promise<RunSession> {
    const hub = await McpHub.connect(agent.mcp);
    const [registry, fence] = await Promise.all([
      ToolRegistry.build(agent, hub),
      Promise.resolve(PrivacyFence.create(agent.privacy)),
    ]);
    const scope: MemoryScope = {
      agentId: agent.agentId,
      namespace: "default",
    };
    const pipe = MemoryPipe.create(
      agent.memory,
      scope,
      agent.model,
      agent.insight?.hypothesize,
      agent.memoryRetrieval.minScore,
      agent.memoryRetrieval.topK,
      agent.memoryRetrieval.budget,
    );
    const controller = new AbortController();
    const rawEmit: (event: RunEvent) => void = onEvent ?? (() => undefined);
    const ledger = new BudgetLedger((ev) => rawEmit(ev));
    return new RunSession(
      agent,
      ctx,
      fence,
      ledger,
      pipe,
      registry,
      hub,
      rawEmit,
      controller,
      suspendSnapshot,
      new PersistenceAdapter(agent.store),
    );
  }

  // ---------------------------------------------------------------------------
  // Accessors
  // ---------------------------------------------------------------------------

  /** Current lifecycle state machine status. */
  get status(): RunSessionStatus {
    return this.lifecycleStatus;
  }

  /** Messages accumulated so far; populated after `run()` or `resume()` returns. */
  get messages(): readonly Message[] {
    return this.messageLog;
  }

  /** The kernel-generated `runId` for this session. */
  get runId(): string {
    return this.ctx.runId;
  }

  // ---------------------------------------------------------------------------
  // Control
  // ---------------------------------------------------------------------------

  /** Abort the current run at the next cancellation point. */
  abort(): void {
    this.controller.abort();
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private get effectiveSignal(): AbortSignal {
    if (this.ctx.signal) {
      return AbortSignal.any([this.ctx.signal, this.controller.signal]);
    }
    return this.controller.signal;
  }

  /** Wrap the raw emit function to intercept the first `text_delta` for TTFT and collect events. */
  private wrapEmitForTelemetry(): (event: RunEvent) => void {
    return (event: RunEvent) => {
      if (event.kind === "text_delta" && this.firstTokenMs === undefined) {
        this.firstTokenMs = Date.now() - this.startTimeMs;
      }
      // Collect all events except text_delta (too high-frequency) for telemetry persistence
      if (event.kind !== "text_delta") {
        const turn =
          "turn" in event && typeof event.turn === "number"
            ? event.turn
            : undefined;
        this.eventLog.push({
          eventId: nanoid(),
          runId: this.ctx.runId,
          ...(turn !== undefined ? { turn } : {}),
          kind: event.kind,
          payload: event as unknown as Record<string, unknown>,
          occurredAt: new Date().toISOString(),
        });
      }
      this.emitRaw(event);
    };
  }

  /** Best-effort wrapper — persistence failures must not surface to callers. */
  private async tryPersist(fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch {
      // Best-effort
    }
  }

  /**
   * Shared completion path for both `run()` and `resume()`.
   * Sets lifecycle status, builds the RunResult, persists it, emits the
   * `complete` event, and returns the result.
   */
  private async finalizeRun(
    emit: (event: RunEvent) => void,
    lastResponse: string,
    state: RunState,
    exitCode: ExitCode,
    durationMs: number,
    createdAt: string,
    insights?: SessionInsights,
  ): Promise<RunResult> {
    this.messageLog = state.messages;
    this.lifecycleStatus = exitCode === "ABORT" ? "ABORTED" : "COMPLETED";
    const runResult = this.buildRunResult(lastResponse, state, exitCode, durationMs);
    await this.tryPersist(() =>
      this.adapter.saveCompletedRun({
        runId: this.ctx.runId,
        agentId: this.agent.agentId,
        result: runResult,
        messages: state.messages,
        metadata: this.ctx.metadata,
        createdAt,
        events: this.eventLog,
        agentSystemPrompt: this.agent.systemPrompt,
        agentModelProvider: this.agent.modelProvider,
        agentModelId: this.agent.modelId,
        insights,
      }),
    );
    emit({ kind: "complete", result: toRunSummary(runResult) });
    // afterRun hook — errors propagate (not wrapped in safeHook)
    if (this.agent.hooks.afterRun) {
      await this.agent.hooks.afterRun(runResult, {
        agentName: this.agent.name,
        runId: this.ctx.runId,
        turn: runResult.turns,
      });
    }
    return runResult;
  }

  private buildToolContext(messages: Message[]): ToolContext {
    return {
      runId: this.ctx.runId,
      agentName: this.agent.name,
      agentId: this.agent.agentId,
      messages,
      store: this.agent.store,
      metadata: this.ctx.metadata,
    };
  }

  private buildTurnCycleContext(emit: (event: RunEvent) => void) {
    return {
      model: this.agent.model,
      registry: this.registry,
      hub: this.hub,
      fence: this.fence,
      ledger: this.ledger,
      hooks: this.agent.hooks,
      hitl: this.agent.hitl,
      agentName: this.agent.name,
      agentId: this.agent.agentId,
      runId: this.ctx.runId,
      emit,
      signal: this.effectiveSignal,
      maxTokens: this.ctx.maxTokens,
      store: this.agent.store,
      metadata: this.ctx.metadata,
    };
  }

  private buildRunResult(
    lastResponse: string,
    state: RunState,
    exitCode: ExitCode,
    durationMs: number,
    extras?: Partial<RunResult>,
  ): RunResult {
    return {
      response: lastResponse,
      messages: state.messages,
      toolCalls: state.toolCallRecords,
      turns: state.turns,
      status: exitCodeToStatus(exitCode),
      totalUsage: this.ledger.state(),
      exitReason: exitCode,
      durationMs,
      firstTokenMs: this.firstTokenMs,
      routingDecisionId: this.ctx.routingDecisionId,
      parentRunId: this.ctx.parentRunId,
      ...extras,
    };
  }

  // ---------------------------------------------------------------------------
  // Execution
  // ---------------------------------------------------------------------------

  /**
   * Execute a new run from user `input`.
   *
   * State transitions: `IDLE` → `RUNNING` → `COMPLETED | ABORTED | ERROR | PAUSED_FOR_INPUT`
   *
   * The MCP hub is disconnected before this method returns — do not call
   * `run()` or `resume()` again on this instance.
   */
  async run(input: string): Promise<RunResult> {
    if (this.lifecycleStatus !== "IDLE") {
      throw new Error(
        `RunSession.run() called in invalid state: ${this.lifecycleStatus}`,
      );
    }
    this.lifecycleStatus = "RUNNING";
    this.startTimeMs = Date.now();
    this.firstTokenMs = undefined;

    const emit = this.wrapEmitForTelemetry();

    try {
      // beforeRun hook — errors propagate (not wrapped in safeHook)
      if (this.agent.hooks.beforeRun) {
        await this.agent.hooks.beforeRun(input, {
          agentName: this.agent.name,
          runId: this.ctx.runId,
          turn: 0,
        });
      }

      // Memory retrieval — inject relevant context into system prompt
      const memories = await this.pipe.retrieve(input);
      let systemPrompt = this.agent.systemPrompt;
      if (memories.length > 0) {
        const seen = new Set<string>();
        const uniqueMemories = memories.filter((m) => {
          const key = m.text.trim().toLowerCase().replace(/\s+/g, " ");
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        systemPrompt = `${this.agent.systemPrompt}\n\nRelevant context:\n${uniqueMemories.map((m) => m.text).join("\n")}`;
      }

      const messages: Message[] = [
        { role: "system", content: systemPrompt },
        { role: "user", content: input },
      ];

      const state: RunState = { messages, toolCallRecords: [], turns: 0 };

      const { lastResponse, exitCode, pendingApprovals } = await runLoop({
        state,
        tcCtx: this.buildTurnCycleContext(emit),
        maxTurns: this.ctx.maxTurns,
        signal: this.effectiveSignal,
        hitl: this.agent.hitl,
        registry: this.registry,
        hub: this.hub,
        buildToolContext: (messages) => this.buildToolContext(messages),
      });
      this.messageLog = state.messages;

      const durationMs = Date.now() - this.startTimeMs;

      // HITL suspend path — persist checkpoint and return early
      if (exitCode === "SUSPEND") {
        this.lifecycleStatus = "PAUSED_FOR_INPUT";
        const checkpointId = nanoid();
        const suspendedAt = new Date().toISOString();
        const expiresAt = new Date(
          Date.now() + DEFAULT_HITL_TIMEOUT,
        ).toISOString();
        const pendingList = pendingApprovals ?? [];
        const triggerToolName = pendingList[0]?.name;
        await this.tryPersist(() =>
          this.adapter.saveSuspendedRun({
            runId: this.ctx.runId,
            agentId: this.agent.agentId,
            checkpointId,
            pendingApprovals: pendingList,
            messages: state.messages,
            metadata: this.ctx.metadata,
            suspendedAt,
            triggerToolName,
            expiresAt,
            agentModelProvider: this.agent.modelProvider,
            agentModelId: this.agent.modelId,
            createdAt: this.createdAt,
            turns: state.turns,
            events: this.eventLog,
          }),
        );
        const suspendResult = this.buildRunResult(
          "",
          state,
          exitCode,
          durationMs,
          {
            status: "awaiting_approval",
            checkpointId,
            pendingApprovals: pendingList,
          },
        );
        emit({ kind: "complete", result: toRunSummary(suspendResult) });
        return suspendResult;
      }

      // Post-run insight
      const insights = await sessionInsight(state, this.agent, this.pipe);
      return this.finalizeRun(emit, lastResponse, state, exitCode, durationMs, this.createdAt, insights);
    } catch (err) {
      this.lifecycleStatus = "ERROR";
      throw err;
    } finally {
      await this.hub.disconnect();
    }
  }

  /**
   * Resume a HITL-suspended run.
   *
   * Expects the session to have been created via `RunSession.createForRestore()`.
   * State transitions: `IDLE` → `RUNNING` → `COMPLETED | ABORTED | ERROR`
   *
   * The MCP hub is disconnected before this method returns.
   */
  async resume(
    checkpointId: string,
    decisions: ApprovalDecision[],
  ): Promise<RunResult> {
    if (this.lifecycleStatus !== "IDLE") {
      throw new Error(
        `RunSession.resume() called in invalid state: ${this.lifecycleStatus}`,
      );
    }
    if (!this.suspendSnapshot) {
      throw new CheckpointError(
        "RunSession.resume() requires a session created via RunSession.createForRestore()",
      );
    }
    this.lifecycleStatus = "RUNNING";
    this.startTimeMs = Date.now();
    this.firstTokenMs = undefined;

    const emit = this.wrapEmitForTelemetry();
    const snapshot = this.suspendSnapshot;

    // Validate all pending approvals have decisions
    const decisionMap = new Map(decisions.map((d) => [d.toolCallId, d]));
    for (const pa of snapshot.pendingApprovals) {
      if (!decisionMap.has(pa.toolCallId)) {
        this.lifecycleStatus = "ERROR";
        throw new CheckpointError(
          `Missing decision for tool call "${pa.toolCallId}" (${pa.name})`,
        );
      }
    }

    try {
      // Increment resume attempt counter on the checkpoint before executing.
      // Best-effort — failure must not block the run.
      await this.tryPersist(() => this.adapter.incrementResumeAttempts(checkpointId));

      // Rebuild state from snapshot
      const state: RunState = {
        messages: [...snapshot.session.messages],
        toolCallRecords: [],
        turns: snapshot.session.messages.filter((m) => m.role === "assistant")
          .length,
      };

      await applyDecisions(
        snapshot.pendingApprovals,
        decisions,
        state,
        this.registry,
        this.hub,
        this.buildToolContext(state.messages),
      );

      // Persist resolved approval decisions for audit trail, then clean up checkpoint.
      const resolvedAt = new Date().toISOString();
      await this.tryPersist(() =>
        this.adapter.resolveApprovals(checkpointId, decisions, "system", resolvedAt),
      );
      // Remove the suspended run checkpoint — replaced by the completed run record below
      await this.tryPersist(() => this.adapter.removeSuspendedRun(checkpointId));

      const { lastResponse, exitCode } = await runLoop({
        state,
        tcCtx: this.buildTurnCycleContext(emit),
        maxTurns: this.ctx.maxTurns,
        signal: this.effectiveSignal,
        hitl: this.agent.hitl,
        registry: this.registry,
        hub: this.hub,
        buildToolContext: (messages) => this.buildToolContext(messages),
      });
      const durationMs = Date.now() - this.startTimeMs;

      // Post-resume insight
      const insights = await sessionInsight(state, this.agent, this.pipe);
      return this.finalizeRun(emit, lastResponse, state, exitCode, durationMs, snapshot.session.createdAt, insights);
    } catch (err) {
      this.lifecycleStatus = "ERROR";
      throw err;
    } finally {
      await this.hub.disconnect();
    }
  }
}
