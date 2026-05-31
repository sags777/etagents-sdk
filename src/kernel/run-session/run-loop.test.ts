import { afterEach, describe, expect, it, vi } from "vitest";
import { createAgent } from "../../agent/agent-builder.js";
import { MockModel } from "../../providers/model/mock/mock.js";
import type { HitlConfig } from "../../types/domain/agent.js";
import type { RunState } from "../../types/domain/run.js";
import type { ToolContext } from "../../types/domain/tool.js";
import { BudgetLedger } from "../budget-ledger/budget-ledger.js";
import * as applyDecisionsModule from "../entry/apply-decisions.js";
import { McpHub } from "../mcp-hub/mcp-hub.js";
import { PrivacyFence } from "../privacy-fence/privacy-fence.js";
import { ToolRegistry } from "../tool-registry/tool-registry.js";
import { TurnCycle } from "../turn-cycle/turn-cycle.js";
import { runLoop } from "./run-loop.js";

afterEach(() => {
  vi.restoreAllMocks();
});

async function makeRunLoopParams(hitl?: HitlConfig) {
  const agent = createAgent({
    name: "agent",
    systemPrompt: ".",
    model: MockModel.create([]),
    hitl,
  });
  const hub = await McpHub.connect([]);
  const registry = await ToolRegistry.build(agent, hub);
  const state: RunState = { messages: [], toolCallRecords: [], turns: 0 };
  const toolContext = (messages: RunState["messages"]): ToolContext => ({
    runId: "run-1",
    agentName: agent.name,
    agentId: agent.agentId,
    messages,
    store: agent.store,
    metadata: {},
  });

  return {
    hub,
    state,
    params: {
      state,
      tcCtx: {
        model: agent.model,
        registry,
        hub,
        fence: PrivacyFence.create(agent.privacy),
        ledger: new BudgetLedger(),
        hooks: agent.hooks,
        hitl: agent.hitl,
        agentName: agent.name,
        agentId: agent.agentId,
        runId: "run-1",
        emit: () => undefined,
        maxTokens: agent.maxTokens,
        store: agent.store,
        metadata: {},
      },
      maxTurns: 2,
      signal: new AbortController().signal,
      hitl: agent.hitl,
      registry,
      hub,
      buildToolContext: toolContext,
    },
  };
}

describe("runLoop", () => {
  it("returns COMPLETE when the turn cycle finishes with a response", async () => {
    const { hub, params } = await makeRunLoopParams();
    vi.spyOn(TurnCycle.prototype, "execute").mockResolvedValueOnce({
      kind: "done",
      response: "hello",
    });

    try {
      await expect(runLoop(params)).resolves.toEqual({
        lastResponse: "hello",
        exitCode: "COMPLETE",
      });
    } finally {
      await hub.disconnect();
    }
  });

  it("returns BUDGET when the turn cycle hits a budget stop", async () => {
    const { hub, params } = await makeRunLoopParams();
    vi.spyOn(TurnCycle.prototype, "execute").mockResolvedValueOnce({
      kind: "budget",
      lastResponse: "partial",
    });

    try {
      await expect(runLoop(params)).resolves.toEqual({
        lastResponse: "partial",
        exitCode: "BUDGET",
      });
    } finally {
      await hub.disconnect();
    }
  });

  it("returns ABORT before executing a turn when the signal is already aborted", async () => {
    const { hub, params } = await makeRunLoopParams();
    const controller = new AbortController();
    controller.abort();
    params.signal = controller.signal;
    const executeSpy = vi.spyOn(TurnCycle.prototype, "execute");

    try {
      const result = await runLoop(params);

      expect(result).toEqual({ lastResponse: "", exitCode: "ABORT" });
      expect(executeSpy).not.toHaveBeenCalled();
    } finally {
      await hub.disconnect();
    }
  });

  it("returns SUSPEND and pending approvals when callback HITL is not configured", async () => {
    const { hub, params } = await makeRunLoopParams({ mode: "tool" });
    const pendingApprovals = [
      { toolCallId: "call-1", name: "danger", args: {}, agentName: "agent" },
    ];
    vi.spyOn(TurnCycle.prototype, "execute").mockResolvedValueOnce({
      kind: "suspend",
      pendingApprovals,
    });

    try {
      await expect(runLoop(params)).resolves.toEqual({
        lastResponse: "",
        exitCode: "SUSPEND",
        pendingApprovals,
      });
    } finally {
      await hub.disconnect();
    }
  });

  it("applies callback HITL decisions and continues the loop", async () => {
    const pendingApprovals = [
      { toolCallId: "call-1", name: "danger", args: {}, agentName: "agent" },
    ];
    const onApprove: NonNullable<HitlConfig["onApprove"]> = vi.fn(
      async (_pending) => [{ toolCallId: "call-1", approved: true }],
    );
    const { hub, params } = await makeRunLoopParams({
      mode: "callback",
      onApprove,
    });
    const applySpy = vi
      .spyOn(applyDecisionsModule, "applyDecisions")
      .mockResolvedValue(undefined);
    vi.spyOn(TurnCycle.prototype, "execute")
      .mockResolvedValueOnce({ kind: "suspend", pendingApprovals })
      .mockResolvedValueOnce({ kind: "done", response: "approved" });

    try {
      const result = await runLoop(params);

      expect(onApprove).toHaveBeenCalledWith(pendingApprovals);
      expect(applySpy).toHaveBeenCalledOnce();
      expect(result).toEqual({ lastResponse: "approved", exitCode: "COMPLETE" });
    } finally {
      await hub.disconnect();
    }
  });

  it("returns MAX_TURNS when the loop exits after repeated continue results", async () => {
    const { hub, params, state } = await makeRunLoopParams();
    vi.spyOn(TurnCycle.prototype, "execute").mockImplementation(async () => {
      state.turns += 1;
      return { kind: "continue" };
    });

    try {
      const result = await runLoop(params);

      expect(result).toEqual({ lastResponse: "", exitCode: "MAX_TURNS" });
      expect(state.turns).toBe(2);
    } finally {
      await hub.disconnect();
    }
  });
});