import { describe, it, expect, vi } from "vitest";
import { createAgent } from "../../agent/agent-builder.js";
import { defineTool } from "../../agent/tool-builder.js";
import { startRun } from "./start.js";
import { continueRun } from "./continue.js";
import { MockModel } from "../../providers/model/mock/mock.js";
import type { StoreProvider } from "../../contracts/store.js";
import type { RunEvent } from "../../types/run.js";
import { PersistenceAdapter } from "../persist/persistence-adapter.js";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMemoryStore(): StoreProvider {
  const map = new Map<string, unknown>();
  return {
    async read<T>(key: string): Promise<T | null> {
      return (map.get(key) ?? null) as T | null;
    },
    async write<T>(key: string, value: T): Promise<void> {
      map.set(key, value);
    },
    async remove(key: string): Promise<void> {
      map.delete(key);
    },
    async list(prefix: string): Promise<string[]> {
      return [...map.keys()].filter((k) => k.startsWith(prefix));
    },
  };
}

// ---------------------------------------------------------------------------
// Event order — normal completion
// ---------------------------------------------------------------------------

describe("startRun — event order", () => {
  it("emits: turn_start → text_delta → text_done → turn_end → complete", async () => {
    const model = MockModel.create([{ kind: "text", content: "Hello!" }]);
    const events: RunEvent[] = [];

    await startRun(
      createAgent({ name: "agent", systemPrompt: "You help.", model }),
      "Hi",
      { onEvent: (e) => events.push(e) },
    );

    const kinds = events.map((e) => e.kind);
    const turnStartIdx = kinds.indexOf("turn_start");
    const textDeltaIdx = kinds.indexOf("text_delta");
    const textDoneIdx = kinds.indexOf("text_done");
    const turnEndIdx = kinds.indexOf("turn_end");
    const completeIdx = kinds.indexOf("complete");

    expect(turnStartIdx).toBeGreaterThanOrEqual(0);
    expect(textDeltaIdx).toBeGreaterThan(turnStartIdx);
    expect(textDoneIdx).toBeGreaterThan(textDeltaIdx);
    expect(turnEndIdx).toBeGreaterThan(textDoneIdx);
    expect(completeIdx).toBeGreaterThan(turnEndIdx);
  });

  it("turn_start.turn and turn_end.turn match the turn number", async () => {
    const model = MockModel.create([{ kind: "text", content: "Reply." }]);
    const events: RunEvent[] = [];

    await startRun(
      createAgent({ name: "agent", systemPrompt: "You help.", model }),
      "Hi",
      { onEvent: (e) => events.push(e) },
    );

    const turnStart = events.find((e) => e.kind === "turn_start") as Extract<
      RunEvent,
      { kind: "turn_start" }
    >;
    const turnEnd = events.find((e) => e.kind === "turn_end") as Extract<
      RunEvent,
      { kind: "turn_end" }
    >;
    expect(turnStart.turn).toBe(1);
    expect(turnEnd.turn).toBe(1);
  });

  it("complete event result matches RunResult shape", async () => {
    const model = MockModel.create([{ kind: "text", content: "OK" }]);
    const events: RunEvent[] = [];

    const result = await startRun(
      createAgent({ name: "agent", systemPrompt: "You help.", model }),
      "Hi",
      { onEvent: (e) => events.push(e) },
    );

    const completeEvent = events.find((e) => e.kind === "complete") as Extract<
      RunEvent,
      { kind: "complete" }
    >;
    expect(completeEvent).toBeDefined();
    expect(completeEvent.result.status).toBe(result.status);
    expect(completeEvent.result.turns).toBe(result.turns);
  });
});

// ---------------------------------------------------------------------------
// Tool call — events and result
// ---------------------------------------------------------------------------

describe("startRun — tool call", () => {
  it("emits tool_call and tool_result events", async () => {
    const echoTool = defineTool({
      name: "echo",
      description: "echoes",
      params: z.object({ msg: z.string() }),
      handler: async ({ msg }) => msg,
    });

    const model = MockModel.create([
      {
        kind: "tools",
        calls: [{ id: "c1", name: "echo", input: { msg: "ping" } }],
      },
      { kind: "text", content: "Done." },
    ]);

    const events: RunEvent[] = [];
    const result = await startRun(
      createAgent({
        name: "agent",
        systemPrompt: "Use tools.",
        model,
        tools: [echoTool],
      }),
      "Ping",
      { onEvent: (e) => events.push(e) },
    );

    const kinds = events.map((e) => e.kind);
    expect(kinds).toContain("tool_call");
    expect(kinds).toContain("tool_result");
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe("echo");
    expect(result.toolCalls[0].result).toBe("ping");
  });

  it("tool_call event carries the agentName", async () => {
    const tool = defineTool({
      name: "noop",
      description: "does nothing",
      params: z.object({}),
      handler: async () => "done",
    });

    const model = MockModel.create([
      { kind: "tools", calls: [{ id: "c1", name: "noop", input: {} }] },
      { kind: "text", content: "ok" },
    ]);

    const events: RunEvent[] = [];
    await startRun(
      createAgent({
        name: "my-agent",
        systemPrompt: ".",
        model,
        tools: [tool],
      }),
      "go",
      { onEvent: (e) => events.push(e) },
    );

    const toolCallEvent = events.find((e) => e.kind === "tool_call") as Extract<
      RunEvent,
      { kind: "tool_call" }
    >;
    expect(toolCallEvent.agentName).toBe("my-agent");
    expect(toolCallEvent.toolCall.name).toBe("noop");
    expect(toolCallEvent.turn).toBe(1);
  });

  it("tool_result isError is false for a successful tool", async () => {
    const tool = defineTool({
      name: "ok",
      description: "succeeds",
      params: z.object({}),
      handler: async () => "success",
    });

    const model = MockModel.create([
      { kind: "tools", calls: [{ id: "c1", name: "ok", input: {} }] },
      { kind: "text", content: "done" },
    ]);

    const events: RunEvent[] = [];
    await startRun(
      createAgent({ name: "agent", systemPrompt: ".", model, tools: [tool] }),
      "go",
      { onEvent: (e) => events.push(e) },
    );

    const toolResultEvent = events.find(
      (e) => e.kind === "tool_result",
    ) as Extract<RunEvent, { kind: "tool_result" }>;
    expect(toolResultEvent.isError).toBe(false);
    expect(toolResultEvent.isFromCache).toBe(false);
    expect(toolResultEvent.result).toBe("success");
    expect(toolResultEvent.turn).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Suspend path (HITL store mode)
// ---------------------------------------------------------------------------

describe("startRun — suspend path", () => {
  it("returns awaiting_approval status with checkpointId", async () => {
    const sensitiveTool = defineTool({
      name: "danger",
      description: "dangerous",
      params: z.object({}),
      handler: async () => "done",
      sensitive: true,
    });

    const model = MockModel.create([
      {
        kind: "tools",
        calls: [{ id: "approve-me", name: "danger", input: {} }],
      },
    ]);

    const store = makeMemoryStore();
    const result = await startRun(
      createAgent({
        name: "agent",
        systemPrompt: "Be cautious.",
        model,
        tools: [sensitiveTool],
        store,
        hitl: { mode: "sensitive" },
      }),
      "Do something dangerous",
    );

    expect(result.status).toBe("awaiting_approval");
    expect(result.checkpointId).toBeDefined();
    expect(typeof result.checkpointId).toBe("string");
  });

  it("writes SuspendSnapshot to the store under eta:suspend:{checkpointId}", async () => {
    const sensitiveTool = defineTool({
      name: "danger",
      description: "dangerous",
      params: z.object({}),
      handler: async () => "done",
      sensitive: true,
    });

    const model = MockModel.create([
      {
        kind: "tools",
        calls: [{ id: "approve-me", name: "danger", input: {} }],
      },
    ]);

    const store = makeMemoryStore();
    const result = await startRun(
      createAgent({
        name: "agent",
        systemPrompt: "Be cautious.",
        model,
        tools: [sensitiveTool],
        store,
        hitl: { mode: "sensitive" },
      }),
      "Do something dangerous",
    );

    const snapshot = await new PersistenceAdapter(store).loadSuspendSnapshot(
      result.checkpointId!,
    );
    expect(snapshot).not.toBeNull();
    expect(snapshot?.pendingApprovals).toHaveLength(1);
    expect(snapshot?.pendingApprovals[0].name).toBe("danger");
  });

  it("pendingApprovals contains the correct tool call details", async () => {
    const tool = defineTool({
      name: "transfer",
      description: "transfers funds",
      params: z.object({ amount: z.number() }),
      handler: async () => "transferred",
      sensitive: true,
    });

    const model = MockModel.create([
      {
        kind: "tools",
        calls: [{ id: "tx-1", name: "transfer", input: { amount: 100 } }],
      },
    ]);

    const store = makeMemoryStore();
    const result = await startRun(
      createAgent({
        name: "agent",
        systemPrompt: "Handle finances.",
        model,
        tools: [tool],
        store,
        hitl: { mode: "sensitive" },
      }),
      "Transfer 100",
    );

    expect(result.pendingApprovals).toHaveLength(1);
    expect(result.pendingApprovals![0].toolCallId).toBe("tx-1");
    expect(result.pendingApprovals![0].args).toEqual({ amount: 100 });
  });
});

// ---------------------------------------------------------------------------
// continueRun round-trip
// ---------------------------------------------------------------------------

describe("continueRun — round-trip via startRun", () => {
  it("resumes a suspended run and returns complete after approval", async () => {
    const actionTool = defineTool({
      name: "action",
      description: "does something",
      params: z.object({}),
      handler: async () => "action done",
    });

    // First call model: returns a tool call (will be suspended)
    // Second call model: after resume, returns final text
    const phaseOneModel = MockModel.create([
      { kind: "tools", calls: [{ id: "call-1", name: "action", input: {} }] },
    ]);
    const phaseTwoModel = MockModel.create([
      { kind: "text", content: "All done." },
    ]);

    const store = makeMemoryStore();
    const agentConfig = {
      name: "agent",
      systemPrompt: "Act carefully.",
      tools: [actionTool],
      store,
      hitl: { mode: "tool" as const },
    };

    // First run: run to suspension
    const suspended = await startRun(
      createAgent({ ...agentConfig, model: phaseOneModel }),
      "Do the action",
    );
    expect(suspended.status).toBe("awaiting_approval");

    const checkpointId = suspended.checkpointId!;

    // Second run: resume with approval using a fresh model that returns final text
    const resumed = await continueRun(
      checkpointId,
      [{ toolCallId: "call-1", approved: true }],
      { agent: createAgent({ ...agentConfig, model: phaseTwoModel }) },
    );

    expect(resumed.status).toBe("complete");
    expect(resumed.response).toBe("All done.");
  });
});

// ---------------------------------------------------------------------------
// Callback HITL — inline approval
// ---------------------------------------------------------------------------

describe("startRun — callback HITL", () => {
  it("calls onApprove and completes without writing a checkpoint", async () => {
    const tool = defineTool({
      name: "risky",
      description: "risky",
      sensitive: true,
      params: z.object({}),
      handler: async () => "executed",
    });

    const model = MockModel.create([
      { kind: "tools", calls: [{ id: "c1", name: "risky", input: {} }] },
      { kind: "text", content: "Finished." },
    ]);

    const store = makeMemoryStore();
    const onApprove = vi
      .fn()
      .mockResolvedValue([{ toolCallId: "c1", approved: true }]);

    const result = await startRun(
      createAgent({
        name: "agent",
        systemPrompt: "Be careful.",
        model,
        tools: [tool],
        store,
        hitl: { mode: "callback", onApprove },
      }),
      "Do the risky thing",
    );

    expect(onApprove).toHaveBeenCalledOnce();
    expect(result.status).toBe("complete");
    expect(result.checkpointId).toBeUndefined();

    // No SuspendSnapshot written to the store
    const keys = await store.list("eta:suspend");
    expect(keys).toHaveLength(0);
  });

  it("onApprove receives the pending approvals list", async () => {
    const tool = defineTool({
      name: "sensitive-action",
      description: "sensitive",
      sensitive: true,
      params: z.object({ payload: z.string() }),
      handler: async () => "done",
    });

    const model = MockModel.create([
      {
        kind: "tools",
        calls: [
          { id: "c1", name: "sensitive-action", input: { payload: "test" } },
        ],
      },
      { kind: "text", content: "ok" },
    ]);

    let capturedPending: unknown[] = [];
    const onApprove = vi.fn().mockImplementation(async (pending) => {
      capturedPending = pending;
      return [{ toolCallId: "c1", approved: true }];
    });

    await startRun(
      createAgent({
        name: "agent",
        systemPrompt: ".",
        model,
        tools: [tool],
        hitl: { mode: "callback", onApprove },
      }),
      "Do it",
    );

    expect(capturedPending).toHaveLength(1);
    expect((capturedPending[0] as { name: string }).name).toBe(
      "sensitive-action",
    );
  });
});

// ---------------------------------------------------------------------------
// Abort
// ---------------------------------------------------------------------------

describe("startRun — abort", () => {
  it("returns cancelled status with zero turns when AbortSignal is pre-fired", async () => {
    const controller = new AbortController();
    controller.abort();

    const model = MockModel.create([{ kind: "text", content: "Too late" }]);

    const result = await startRun(
      createAgent({ name: "agent", systemPrompt: "You help.", model }),
      "Hello",
      { signal: controller.signal },
    );

    expect(result.status).toBe("cancelled");
    expect(result.turns).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Budget
// ---------------------------------------------------------------------------

describe("startRun — budget", () => {
  it("returns budget_exceeded when token limit is exceeded after a tool turn", async () => {
    const loopTool = defineTool({
      name: "loop",
      description: "loops",
      params: z.object({}),
      handler: async () => "looped",
    });

    const model = MockModel.create([]);
    // Override stream to return tool calls with usage exceeding the limit
    model.stream = async function* () {
      yield { type: "tool_start" as const, toolCallId: "c1", toolName: "loop" };
      yield { type: "tool_delta" as const, toolCallId: "c1", inputDelta: "{}" };
      yield { type: "tool_end" as const, toolCallId: "c1", input: {} };
      yield {
        type: "finish" as const,
        finishReason: "tool_use" as const,
        usage: { prompt: 500, completion: 500, total: 1000 },
      };
    };

    const result = await startRun(
      createAgent({
        name: "agent",
        systemPrompt: "Loop.",
        model,
        tools: [loopTool],
      }),
      "Go",
      { maxTokens: 50 },
    );

    expect(result.status).toBe("budget_exceeded");
  });
});

// ---------------------------------------------------------------------------
// maxTurns
// ---------------------------------------------------------------------------

describe("startRun — maxTurns", () => {
  it("exits the loop when maxTurns is reached", async () => {
    const loopTool = defineTool({
      name: "loop",
      description: "loops forever",
      params: z.object({}),
      handler: async () => "looped",
    });

    const model = MockModel.create([
      { kind: "tools", calls: [{ id: "c1", name: "loop", input: {} }] },
      { kind: "tools", calls: [{ id: "c2", name: "loop", input: {} }] },
      { kind: "tools", calls: [{ id: "c3", name: "loop", input: {} }] },
      { kind: "text", content: "done eventually" },
    ]);

    const result = await startRun(
      createAgent({
        name: "agent",
        systemPrompt: "Loop.",
        model,
        tools: [loopTool],
      }),
      "Go",
      { maxTurns: 2 },
    );

    expect(result.turns).toBeLessThanOrEqual(2);
  });

  it("returns complete status (not error) when maxTurns loop exits", async () => {
    const loopTool = defineTool({
      name: "loop",
      description: "loops",
      params: z.object({}),
      handler: async () => "looped",
    });

    const model = MockModel.create([
      { kind: "tools", calls: [{ id: "c1", name: "loop", input: {} }] },
      { kind: "tools", calls: [{ id: "c2", name: "loop", input: {} }] },
      { kind: "text", content: "finally" },
    ]);

    const result = await startRun(
      createAgent({
        name: "agent",
        systemPrompt: ".",
        model,
        tools: [loopTool],
      }),
      "Go",
      { maxTurns: 1 },
    );

    // After maxTurns, ExitCode.MAX_TURNS maps to status "complete"
    expect(result.status).toBe("complete");
  });
});
