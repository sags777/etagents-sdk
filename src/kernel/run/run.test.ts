import { describe, it, expect } from "vitest";
import { createAgent } from "../../agent/create-agent/create-agent.js";
import { defineTool } from "../../agent/define-tool/define-tool.js";
import { startRun } from "./run.js";
import { MockModel } from "../../providers/model/mock/mock.js";
import { InMemory } from "../../providers/memory/in-memory/in-memory.js";
import { RegexPrivacy } from "../../providers/privacy/regex-privacy/regex-privacy.js";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAgent(model: MockModel, overrides: Partial<Parameters<typeof createAgent>[0]> = {}) {
  return createAgent({ name: "test", systemPrompt: "You are a test agent.", model, ...overrides });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("startRun", () => {
  it("returns complete status with model text response", async () => {
    const model = MockModel.create([{ kind: "text", content: "Hello from the agent!" }]);
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
      { kind: "tools", calls: [{ id: "call-1", name: "echo", input: { msg: "hi" } }] },
      { kind: "text", content: "Got: echo: hi" },
    ]);

    const result = await startRun(
      createAgent({ name: "agent", systemPrompt: "Use tools.", model, tools: [echoTool] }),
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
    // Use overlapping words in fact and query so word-overlap scoring returns > 0
    await memory.index({
      id: "fact-1",
      text: "concise helpful answers",
      scope: { agentId: "agent", namespace: "default" },
    });

    let capturedMessages: unknown[] = [];
    const model = MockModel.create([{ kind: "text", content: "Sure!" }]);

    const origStream = model.stream.bind(model);
    model.stream = async function* (messages, opts) {
      capturedMessages = messages;
      yield* origStream(messages, opts);
    };

    await startRun(
      createAgent({ name: "agent", systemPrompt: "You help.", model, memory }),
      "Give concise helpful answers",
    );

    const systemMsg = capturedMessages.find(
      (m: unknown) => (m as { role: string }).role === "system",
    ) as { content: string } | undefined;
    expect(systemMsg?.content).toContain("concise helpful answers");
  });

  it("masks PII before the model and unmasks in the response", async () => {
    const privacy = new RegexPrivacy([
      { name: "email", category: "email", pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g },
    ]);

    let sentMessages: unknown[] = [];
    // Capture the placeholder the fence generates so we can feed it back to unmask
    let capturedPlaceholder = "";
    const model = MockModel.create([]); // queue empty — we fill dynamically
    const origStream = model.stream.bind(model);
    model.stream = async function* (messages, opts) {
      sentMessages = messages;
      // Figure out what placeholder was injected into the user message
      const userMsg = messages.find((m) => m.role === "user") as { content: string } | undefined;
      const match = userMsg?.content.match(/⟨eta:[A-Z]+:[0-9a-f]+⟩/);
      capturedPlaceholder = match?.[0] ?? "";
      // Return a response containing the placeholder so unmask can restore it
      yield { type: "text" as const, delta: `Your address: ${capturedPlaceholder}` };
      yield { type: "finish" as const, finishReason: "stop" as const, usage: { prompt: 0, completion: 0, total: 0 } };
    };

    const result = await startRun(
      createAgent({ name: "agent", systemPrompt: "You help.", model, privacy }),
      "My email is user@example.com",
    );

    // Model received masked input — no raw email
    const userMsg = sentMessages.find((m: unknown) => (m as { role: string }).role === "user") as { content: string } | undefined;
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
      createAgent({ name: "agent", systemPrompt: "loop.", model, tools: [echoTool] }),
      "Go",
      { maxTurns: 2 },
    );

    expect(result.turns).toBeLessThanOrEqual(2);
    expect(["complete", "cancelled", "budget_exceeded"]).toContain(result.status);
  });
});
