import { describe, it, expect } from "vitest";
import { createAgent } from "../../agent/agent-builder.js";
import { defineTool } from "../../agent/tool-builder.js";
import { startRun } from "./start.js";
import { MockModel } from "../../providers/model/mock/mock.js";
import { InMemory } from "../../providers/memory/in-memory/in-memory.js";
import { RegexPrivacy } from "../../providers/privacy/regex-privacy/regex-privacy.js";
import { z } from "zod";
import type { StoreProvider } from "../../contracts/store.js";

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
// Helpers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

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
    expect(result.messages).toHaveLength(3); // system + user + assistant
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
    // system, user, assistant(tool_call), tool(result), assistant(final)
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
    // Use overlapping words in fact and query so word-overlap scoring returns > 0
    await memory.index({
      id: "fact-1",
      text: "concise helpful answers",
      scope: { agentId: agent.agentId, namespace: "default" },
    });

    let capturedMessages: unknown[] = [];
    const model = agent.model as MockModel;

    const origStream = model.stream.bind(model);
    model.stream = async function* (messages, opts) {
      capturedMessages = messages;
      yield* origStream(messages, opts);
    };

    await startRun(agent, "Give concise helpful answers");

    const systemMsg = capturedMessages.find(
      (m: unknown) => (m as { role: string }).role === "system",
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
    // Capture the placeholder the fence generates so we can feed it back to unmask
    let capturedPlaceholder = "";
    const model = MockModel.create([]); // queue empty — we fill dynamically
    model.stream = async function* (messages) {
      sentMessages = messages;
      // Figure out what placeholder was injected into the user message
      const userMsg = messages.find((m) => m.role === "user") as
        | { content: string }
        | undefined;
      const match = userMsg?.content.match(/⟨eta:[A-Z]+:[0-9a-f]+⟩/);
      capturedPlaceholder = match?.[0] ?? "";
      // Return a response containing the placeholder so unmask can restore it
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

    // Model received masked input — no raw email
    const userMsg = sentMessages.find(
      (m: unknown) => (m as { role: string }).role === "user",
    ) as { content: string } | undefined;
    expect(userMsg?.content).not.toContain("user@example.com");
    expect(userMsg?.content).toMatch(/⟨eta:/);

    // Response was unmasked — placeholder replaced with original email
    expect(result.response).not.toContain(capturedPlaceholder);
    expect(result.response).toContain("user@example.com");
  });

  it("returns cancelled status when AbortSignal fires", async () => {
    const controller = new AbortController();
    const model = MockModel.create([{ kind: "text", content: "Too late" }]);

    // Abort immediately before startRun has a chance to complete the first turn
    controller.abort();

    const result = await startRun(
      createAgent({ name: "agent", systemPrompt: "You help.", model }),
      "Hello",
      { signal: controller.signal },
    );

    expect(result.status).toBe("cancelled");
    expect(result.turns).toBe(0);
  });

  it("returns complete when maxTurns is reached", async () => {
    // Provide more tool-call responses than maxTurns allows
    const echoTool = defineTool({
      name: "loop",
      description: "loops",
      params: z.object({}),
      handler: async () => "looped",
    });

    const model = MockModel.create([
      { kind: "tools", calls: [{ id: "c1", name: "loop", input: {} }] },
      { kind: "tools", calls: [{ id: "c2", name: "loop", input: {} }] },
      { kind: "tools", calls: [{ id: "c3", name: "loop", input: {} }] },
      { kind: "text", content: "done" },
    ]);

    const result = await startRun(
      createAgent({
        name: "agent",
        systemPrompt: "loop.",
        model,
        tools: [echoTool],
      }),
      "Go",
      { maxTurns: 2 },
    );

    expect(result.turns).toBeLessThanOrEqual(2);
    expect(["complete", "cancelled", "budget_exceeded"]).toContain(
      result.status,
    );
  });

  describe("lifecycle hooks — beforeRun / afterRun", () => {
    it("calls beforeRun before the run with input and hook context", async () => {
      const calls: Array<{ input: string; agentName: string; turn: number }> =
        [];
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
      expect(calls[0].input).toBe("test input");
      expect(calls[0].agentName).toBe("hook-agent");
      expect(calls[0].turn).toBe(0);
    });

    it("calls afterRun after the run with result and hook context", async () => {
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
      expect(calls[0].response).toBe("Hello!");
      expect(calls[0].agentName).toBe("hook-agent");
    });

    it("propagates beforeRun errors — run does not complete silently", async () => {
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

    it("propagates afterRun errors — caller receives the error", async () => {
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
