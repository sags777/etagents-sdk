import { describe, expect, it } from "vitest";
import { nanoid } from "nanoid";
import { z } from "zod";
import { createAgent } from "../../agent/agent-builder.js";
import { defineTool } from "../../agent/tool-builder.js";
import type { StoreProvider } from "../../types/contracts/store.js";
import { CheckpointError } from "../../lib/errors.js";
import { MockModel } from "../../providers/model/mock/mock.js";
import { PersistenceAdapter } from "../persist/persistence-adapter.js";
import { continueRun } from "./continue.js";
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

async function writeSuspendFixture(
  store: StoreProvider,
  opts: {
    runId?: string;
    toolCallId?: string;
    toolName?: string;
    agentName?: string;
    args?: Record<string, unknown>;
  } = {},
): Promise<{ checkpointId: string; runId: string }> {
  const checkpointId = nanoid();
  const runId = opts.runId ?? nanoid();
  const toolCallId = opts.toolCallId ?? "tool-call-1";
  const toolName = opts.toolName ?? "action";
  const agentName = opts.agentName ?? "agent";
  const args = opts.args ?? {};
  const now = new Date().toISOString();

  await new PersistenceAdapter(store).saveSuspendedRun({
    runId,
    agentId: agentName,
    checkpointId,
    pendingApprovals: [{ toolCallId, name: toolName, args, agentName }],
    messages: [
      { role: "system", content: "You are helpful." },
      { role: "user", content: "Do the action" },
      {
        role: "assistant",
        content: "",
        toolCalls: [{ id: toolCallId, name: toolName, args }],
      },
    ],
    metadata: {},
    suspendedAt: now,
    createdAt: now,
    turns: 1,
    events: [],
  });

  return { checkpointId, runId };
}

describe("continueRun", () => {
  it("resumes a suspended startRun round-trip after approval", async () => {
    const actionTool = defineTool({
      name: "action",
      description: "does something",
      params: z.object({}),
      handler: async () => "action done",
    });

    const phaseOneModel = MockModel.create([
      { kind: "tools", calls: [{ id: "call-1", name: "action", input: {} }] },
    ]);
    const phaseTwoModel = MockModel.create([{ kind: "text", content: "All done." }]);

    const store = makeMemoryStore();
    const agentConfig = {
      name: "agent",
      systemPrompt: "Act carefully.",
      tools: [actionTool],
      store,
      hitl: { mode: "tool" as const },
    };

    const suspended = await startRun(
      createAgent({ ...agentConfig, model: phaseOneModel }),
      "Do the action",
    );

    expect(suspended.status).toBe("awaiting_approval");

    const resumed = await continueRun(
      suspended.checkpointId!,
      [{ toolCallId: "call-1", approved: true }],
      { agent: createAgent({ ...agentConfig, model: phaseTwoModel }) },
    );

    expect(resumed.status).toBe("complete");
    expect(resumed.response).toBe("All done.");
  });

  it("resumes and completes after a single approved tool call", async () => {
    const actionTool = defineTool({
      name: "action",
      description: "does something",
      params: z.object({}),
      handler: async () => "action executed",
    });

    const model = MockModel.create([{ kind: "text", content: "Task complete." }]);
    const store = makeMemoryStore();
    const { checkpointId } = await writeSuspendFixture(store, {
      toolCallId: "call-1",
      toolName: "action",
      agentName: "agent",
    });

    const result = await continueRun(
      checkpointId,
      [{ toolCallId: "call-1", approved: true }],
      {
        agent: createAgent({
          name: "agent",
          systemPrompt: "You are helpful.",
          model,
          tools: [actionTool],
          store,
        }),
      },
    );

    expect(result.status).toBe("complete");
    expect(result.response).toBe("Task complete.");
  });

  it("removes the suspend snapshot from the store after resuming", async () => {
    const actionTool = defineTool({
      name: "action",
      description: "does something",
      params: z.object({}),
      handler: async () => "done",
    });

    const model = MockModel.create([{ kind: "text", content: "OK." }]);
    const store = makeMemoryStore();
    const { checkpointId } = await writeSuspendFixture(store, {
      toolCallId: "call-2",
      toolName: "action",
    });

    await continueRun(
      checkpointId,
      [{ toolCallId: "call-2", approved: true }],
      {
        agent: createAgent({
          name: "agent",
          systemPrompt: ".",
          model,
          tools: [actionTool],
          store,
        }),
      },
    );

    const snapshot = await new PersistenceAdapter(store).loadSuspendSnapshot(
      checkpointId,
    );
    expect(snapshot).toBeNull();
  });

  it("includes the tool result in messages after an approved execution", async () => {
    const echoTool = defineTool({
      name: "echo",
      description: "echoes",
      params: z.object({ msg: z.string() }),
      handler: async ({ msg }) => `echo: ${msg}`,
    });

    const model = MockModel.create([{ kind: "text", content: "Got the echo." }]);
    const store = makeMemoryStore();
    const { checkpointId } = await writeSuspendFixture(store, {
      toolCallId: "e1",
      toolName: "echo",
      args: { msg: "hello" },
    });

    const result = await continueRun(
      checkpointId,
      [{ toolCallId: "e1", approved: true }],
      {
        agent: createAgent({
          name: "agent",
          systemPrompt: "Help.",
          model,
          tools: [echoTool],
          store,
        }),
      },
    );

    expect(result.status).toBe("complete");
    const toolMsg = result.messages.find((message) => message.role === "tool");
    expect(toolMsg?.content).toBe("echo: hello");
  });

  it("injects a synthetic rejection message when the approval is denied", async () => {
    const tool = defineTool({
      name: "action",
      description: "does something",
      params: z.object({}),
      handler: async () => "executed",
    });

    const model = MockModel.create([
      { kind: "text", content: "I understand it was rejected." },
    ]);
    const store = makeMemoryStore();
    const { checkpointId } = await writeSuspendFixture(store, {
      toolCallId: "r1",
      toolName: "action",
      agentName: "agent",
    });

    const result = await continueRun(
      checkpointId,
      [{ toolCallId: "r1", approved: false }],
      {
        agent: createAgent({
          name: "agent",
          systemPrompt: ".",
          model,
          tools: [tool],
          store,
        }),
      },
    );

    expect(result.status).toBe("complete");
    const toolMsg = result.messages.find((message) => message.role === "tool");
    expect(toolMsg?.content).toContain("rejected");
  });

  it("throws CheckpointError when a pending approval has no decision", async () => {
    const model = MockModel.create([{ kind: "text", content: "Never reached." }]);
    const store = makeMemoryStore();
    const { checkpointId } = await writeSuspendFixture(store, {
      toolCallId: "missing-decision",
      toolName: "action",
    });

    const agent = createAgent({
      name: "agent",
      systemPrompt: ".",
      model,
      store,
    });

    await expect(continueRun(checkpointId, [], { agent })).rejects.toThrow(
      CheckpointError,
    );
  });

  it("mentions the missing tool call in CheckpointError messages", async () => {
    const model = MockModel.create([]);
    const store = makeMemoryStore();
    const { checkpointId } = await writeSuspendFixture(store, {
      toolCallId: "call-xyz",
      toolName: "action",
    });

    const agent = createAgent({
      name: "agent",
      systemPrompt: ".",
      model,
      store,
    });

    await expect(continueRun(checkpointId, [], { agent })).rejects.toThrow(
      /call-xyz/,
    );
  });

  it("throws CheckpointError for an unknown checkpointId", async () => {
    const model = MockModel.create([]);
    const store = makeMemoryStore();
    const agent = createAgent({
      name: "agent",
      systemPrompt: ".",
      model,
      store,
    });

    await expect(
      continueRun("nonexistent-checkpoint-id", [], { agent }),
    ).rejects.toThrow(CheckpointError);
  });
});