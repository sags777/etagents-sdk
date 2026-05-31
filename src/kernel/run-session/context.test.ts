import { describe, expect, it } from "vitest";
import { createAgent } from "../../agent/agent-builder.js";
import { MockModel } from "../../providers/model/mock/mock.js";
import { buildRestoreContext, buildRunContext } from "./context.js";

describe("run-session context builders", () => {
  it("ignores config.runId and applies per-run overrides for new runs", () => {
    const agent = createAgent({
      name: "agent",
      systemPrompt: ".",
      model: MockModel.create([]),
      maxTurns: 5,
      maxTokens: 200,
    });

    const ctx = buildRunContext(agent, {
      runId: "caller-supplied",
      maxTurns: 2,
      maxTokens: 50,
      metadata: { source: "test" },
      routingDecisionId: "decision-1",
      parentRunId: "parent-1",
    });

    expect(ctx.runId).not.toBe("caller-supplied");
    expect(ctx.maxTurns).toBe(2);
    expect(ctx.maxTokens).toBe(50);
    expect(ctx.metadata).toEqual({ source: "test" });
    expect(ctx.routingDecisionId).toBe("decision-1");
    expect(ctx.parentRunId).toBe("parent-1");
  });

  it("preserves the stored runId when rebuilding restore context", () => {
    const agent = createAgent({
      name: "agent",
      systemPrompt: ".",
      model: MockModel.create([]),
      maxTurns: 7,
      maxTokens: 300,
    });

    const ctx = buildRestoreContext(agent, "stored-run", {
      metadata: { restored: true },
    });

    expect(ctx.runId).toBe("stored-run");
    expect(ctx.maxTurns).toBe(7);
    expect(ctx.maxTokens).toBe(300);
    expect(ctx.metadata).toEqual({ restored: true });
  });
});