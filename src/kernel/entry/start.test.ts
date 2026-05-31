import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createAgent } from "../../agent/agent-builder.js";
import { defineTool } from "../../agent/tool-builder.js";
import type { StoreProvider } from "../../types/contracts/store.js";
import { InMemory } from "../../providers/memory/in-memory/in-memory.js";
import { MockModel } from "../../providers/model/mock/mock.js";
import { RegexPrivacy } from "../../providers/privacy/regex-privacy/regex-privacy.js";
import type { RunEvent } from "../../types/domain/run.js";
import { PersistenceAdapter } from "../persist/persistence-adapter.js";
import { startRun } from "./start.js";

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
      return [...map.keys()].filter((key) => key.startsWith(prefix));
    },
  };
}

describe("startRun", () => {
  it("returns complete status with model text response", async () => {
    const model = MockModel.create([
      { kind: "text", content: "Hello from the agent!" },
    ]);

    const result = await startRun(
      createAgent({ name: "agent", systemPrompt: "You help.", model }),
      "Hello",
    );

    expect(result.status).toBe("complete");
    expect(result.response).toBe("Hello from the agent!");
    expect(result.turns).toBe(1);
    expect(result.messages).toHaveLength(3);
  });

  it("executes a tool call and returns final text response", async () => {
    const echoTool = defineTool({
      name: "echo",
      description: "echoes its input",
      params: z.object({ msg: z.string() }),
      handler: async ({ msg }) => `echo: ${msg}`,
    });

    const model = MockModel.create([
      {
        kind: "tools",
        calls: [{ id: "call-1", name: "echo", input: { msg: "hi" } }],
      },
      { kind: "text", content: "Got: echo: hi" },
    ]);

    const result = await startRun(
      createAgent({
        name: "agent",
        systemPrompt: "Use tools.",
        model,
        tools: [echoTool],
      }),
      "Say hello",
    );

    expect(result.status).toBe("complete");
    expect(result.response).toBe("Got: echo: hi");
    expect(result.turns).toBe(2);
    expect(result.messages.length).toBeGreaterThanOrEqual(4);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe("echo");
    expect(result.toolCalls[0].result).toBe("echo: hi");
  });

  it("retrieves and injects memory into system prompt", async () => {
    const memory = new InMemory();
    const agent = createAgent({
      name: "agent",
      systemPrompt: "You help.",
      model: MockModel.create([{ kind: "text", content: "Sure!" }]),
      memory,
    });
    await memory.index({
      id: "fact-1",
      text: "concise helpful answers",
      scope: { agentId: agent.agentId, namespace: "default" },
    });

    let capturedMessages: unknown[] = [];
    const model = agent.model as MockModel;
    const originalStream = model.stream.bind(model);
    model.stream = async function* (messages, opts) {
      capturedMessages = messages;
      yield* originalStream(messages, opts);
    };

    await startRun(agent, "Give concise helpful answers");

    const systemMsg = capturedMessages.find(
      (message: unknown) => (message as { role: string }).role === "system",
    ) as { content: string } | undefined;
    expect(systemMsg?.content).toContain("concise helpful answers");
  });

  it("masks PII before the model and unmasks in the response", async () => {
    const privacy = new RegexPrivacy([
      {
        name: "email",
        category: "email",
        pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
      },
    ]);

    let sentMessages: unknown[] = [];
    let capturedPlaceholder = "";
    const model = MockModel.create([]);
    model.stream = async function* (messages) {
      sentMessages = messages;
      const userMsg = messages.find((message) => message.role === "user") as
        | { content: string }
        | undefined;
      const match = userMsg?.content.match(/⟨eta:[A-Z]+:[0-9a-f]+⟩/);
      capturedPlaceholder = match?.[0] ?? "";
      yield {
        type: "text" as const,
        delta: `Your address: ${capturedPlaceholder}`,
      };
      yield {
        type: "finish" as const,
        finishReason: "stop" as const,
        usage: { prompt: 0, completion: 0, total: 0 },
      };
    };

    const result = await startRun(
      createAgent({ name: "agent", systemPrompt: "You help.", model, privacy }),
      "My email is user@example.com",
    );

    const userMsg = sentMessages.find(
      (message: unknown) => (message as { role: string }).role === "user",
    ) as { content: string } | undefined;
    expect(userMsg?.content).not.toContain("user@example.com");
    expect(userMsg?.content).toMatch(/⟨eta:/);
    expect(result.response).not.toContain(capturedPlaceholder);
    expect(result.response).toContain("user@example.com");
  });

  describe("events", () => {
    it("emits turn_start, text_delta, text_done, turn_end, and complete in order", async () => {
      const model = MockModel.create([{ kind: "text", content: "Hello!" }]);
      const events: RunEvent[] = [];

      await startRun(
        createAgent({ name: "agent", systemPrompt: "You help.", model }),
        "Hi",
        { onEvent: (event) => events.push(event) },
      );

      const kinds = events.map((event) => event.kind);
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

    it("emits matching turn numbers for turn_start and turn_end", async () => {
      const model = MockModel.create([{ kind: "text", content: "Reply." }]);
      const events: RunEvent[] = [];

      await startRun(
        createAgent({ name: "agent", systemPrompt: "You help.", model }),
        "Hi",
        { onEvent: (event) => events.push(event) },
      );

      const turnStart = events.find((event) => event.kind === "turn_start") as Extract<
        RunEvent,
        { kind: "turn_start" }
      >;
      const turnEnd = events.find((event) => event.kind === "turn_end") as Extract<
        RunEvent,
        { kind: "turn_end" }
      >;

      expect(turnStart.turn).toBe(1);
      expect(turnEnd.turn).toBe(1);
    });

    it("emits a complete event that matches the returned summary", async () => {
      const model = MockModel.create([{ kind: "text", content: "OK" }]);
      const events: RunEvent[] = [];

      const result = await startRun(
        createAgent({ name: "agent", systemPrompt: "You help.", model }),
        "Hi",
        { onEvent: (event) => events.push(event) },
      );

      const completeEvent = events.find((event) => event.kind === "complete") as Extract<
        RunEvent,
        { kind: "complete" }
      >;

      expect(completeEvent.result.status).toBe(result.status);
      expect(completeEvent.result.turns).toBe(result.turns);
    });

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
        { onEvent: (event) => events.push(event) },
      );

      const kinds = events.map((event) => event.kind);
      expect(kinds).toContain("tool_call");
      expect(kinds).toContain("tool_result");
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].name).toBe("echo");
      expect(result.toolCalls[0].result).toBe("ping");
    });

    it("includes the agent name on tool_call events", async () => {
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
        { onEvent: (event) => events.push(event) },
      );

      const toolCallEvent = events.find((event) => event.kind === "tool_call") as Extract<
        RunEvent,
        { kind: "tool_call" }
      >;

      expect(toolCallEvent.agentName).toBe("my-agent");
      expect(toolCallEvent.toolCall.name).toBe("noop");
      expect(toolCallEvent.turn).toBe(1);
    });

    it("marks successful tool_result events as non-errors and non-cached", async () => {
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
        { onEvent: (event) => events.push(event) },
      );

      const toolResultEvent = events.find((event) => event.kind === "tool_result") as Extract<
        RunEvent,
        { kind: "tool_result" }
      >;

      expect(toolResultEvent.isError).toBe(false);
      expect(toolResultEvent.isFromCache).toBe(false);
      expect(toolResultEvent.result).toBe("success");
      expect(toolResultEvent.turn).toBe(1);
    });
  });

  describe("suspend paths", () => {
    it("returns awaiting_approval with a checkpointId for sensitive tools", async () => {
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
      expect(typeof result.checkpointId).toBe("string");
    });

    it("persists the suspend snapshot with the pending approval", async () => {
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

    it("returns the correct pending approval details", async () => {
      const transferTool = defineTool({
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
          tools: [transferTool],
          store,
          hitl: { mode: "sensitive" },
        }),
        "Transfer 100",
      );

      expect(result.pendingApprovals).toHaveLength(1);
      expect(result.pendingApprovals?.[0].toolCallId).toBe("tx-1");
      expect(result.pendingApprovals?.[0].args).toEqual({ amount: 100 });
    });

    it("handles callback HITL inline without writing a checkpoint", async () => {
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
      expect(await store.list("eta:suspend")).toHaveLength(0);
    });

    it("passes the pending approvals list to callback HITL", async () => {
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

  describe("run controls", () => {
    it("returns cancelled when AbortSignal fires before the first turn", async () => {
      const controller = new AbortController();
      const model = MockModel.create([{ kind: "text", content: "Too late" }]);

      controller.abort();

      const result = await startRun(
        createAgent({ name: "agent", systemPrompt: "You help.", model }),
        "Hello",
        { signal: controller.signal },
      );

      expect(result.status).toBe("cancelled");
      expect(result.turns).toBe(0);
    });

    it("returns budget_exceeded when token usage crosses the limit", async () => {
      const loopTool = defineTool({
        name: "loop",
        description: "loops",
        params: z.object({}),
        handler: async () => "looped",
      });

      const model = MockModel.create([]);
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

    it("returns complete when the run exits on maxTurns", async () => {
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

      expect(result.status).toBe("complete");
    });
  });

  describe("lifecycle hooks", () => {
    it("calls beforeRun before the run with the hook context", async () => {
      const calls: Array<{ input: string; agentName: string; turn: number }> = [];
      const model = MockModel.create([{ kind: "text", content: "Done" }]);

      await startRun(
        createAgent({
          name: "hook-agent",
          systemPrompt: "You help.",
          model,
          hooks: {
            beforeRun: (input, ctx) => {
              calls.push({ input, agentName: ctx.agentName, turn: ctx.turn });
            },
          },
        }),
        "test input",
      );

      expect(calls).toHaveLength(1);
      expect(calls[0]).toEqual({
        input: "test input",
        agentName: "hook-agent",
        turn: 0,
      });
    });

    it("calls afterRun after the run with the hook context", async () => {
      const calls: Array<{ response: string; agentName: string }> = [];
      const model = MockModel.create([{ kind: "text", content: "Hello!" }]);

      await startRun(
        createAgent({
          name: "hook-agent",
          systemPrompt: "You help.",
          model,
          hooks: {
            afterRun: (result, ctx) => {
              calls.push({ response: result.response, agentName: ctx.agentName });
            },
          },
        }),
        "hello",
      );

      expect(calls).toHaveLength(1);
      expect(calls[0]).toEqual({ response: "Hello!", agentName: "hook-agent" });
    });

    it("propagates beforeRun errors", async () => {
      const model = MockModel.create([{ kind: "text", content: "Never" }]);

      await expect(
        startRun(
          createAgent({
            name: "agent",
            systemPrompt: "You help.",
            model,
            hooks: {
              beforeRun: async () => {
                throw new Error("pre-flight failed");
              },
            },
          }),
          "hi",
        ),
      ).rejects.toThrow("pre-flight failed");
    });

    it("propagates afterRun errors", async () => {
      const model = MockModel.create([{ kind: "text", content: "Done" }]);

      await expect(
        startRun(
          createAgent({
            name: "agent",
            systemPrompt: "You help.",
            model,
            hooks: {
              afterRun: async () => {
                throw new Error("post-run failed");
              },
            },
          }),
          "hi",
        ),
      ).rejects.toThrow("post-run failed");
    });
  });
});