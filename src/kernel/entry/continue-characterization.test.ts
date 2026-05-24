import { describe, it, expect } from "vitest";
import { continueRun } from "./continue.js";
import { createAgent } from "../../agent/agent-builder.js";
import { defineTool } from "../../agent/tool-builder.js";
import { MockModel } from "../../providers/model/mock/mock.js";
import { CheckpointError } from "../../errors.js";
import type { StoreProvider } from "../../contracts/store.js";
import { PersistenceAdapter } from "../persist/persistence-adapter.js";
import { z } from "zod";
import { nanoid } from "nanoid";

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

/**
 * Build a minimal SuspendSnapshot fixture and write it to the store using
 * PersistenceAdapter (same path as RunSession).
 * Returns the checkpointId.
 */
async function writeSuspendFixture(
  store: StoreProvider,
  opts: {
    runId?: string;
    toolCallId?: string;
    toolName?: string;
    agentName?: string;
  } = {},
): Promise<string> {
  const checkpointId = nanoid();
  const runId = opts.runId ?? nanoid();
  const toolCallId = opts.toolCallId ?? "tool-call-1";
  const toolName = opts.toolName ?? "action";
  const agentName = opts.agentName ?? "agent";
  const now = new Date().toISOString();

  const adapter = new PersistenceAdapter(store);
  await adapter.saveSuspendedRun({
    runId,
    agentId: agentName,
    checkpointId,
    pendingApprovals: [{ toolCallId, name: toolName, args: {}, agentName }],
    messages: [
      { role: "system", content: "You are helpful." },
      { role: "user", content: "Do the action" },
      {
        role: "assistant",
        content: "",
        toolCalls: [{ id: toolCallId, name: toolName, args: {} }],
      },
    ],
    metadata: {},
    suspendedAt: now,
    createdAt: now,
    turns: 1,
    events: [],
  });

  return checkpointId;
}

// ---------------------------------------------------------------------------
// Resume with approved decision
// ---------------------------------------------------------------------------

describe("continueRun — approved decisions", () => {
  it("resumes and completes after a single approved tool call", async () => {
    const actionTool = defineTool({
      name: "action",
      description: "does something",
      params: z.object({}),
      handler: async () => "action executed",
    });

    const model = MockModel.create([
      { kind: "text", content: "Task complete." },
    ]);
    const store = makeMemoryStore();

    const checkpointId = await writeSuspendFixture(store, {
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

  it("removes the SuspendSnapshot from the store after resuming", async () => {
    const actionTool = defineTool({
      name: "action",
      description: "does something",
      params: z.object({}),
      handler: async () => "done",
    });

    const model = MockModel.create([{ kind: "text", content: "OK." }]);
    const store = makeMemoryStore();

    const checkpointId = await writeSuspendFixture(store, {
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

    // Snapshot must be removed after resume
    const snapshot = await new PersistenceAdapter(store).loadSuspendSnapshot(
      checkpointId,
    );
    expect(snapshot).toBeNull();
  });

  it("includes tool result in messages after approved execution", async () => {
    const echoTool = defineTool({
      name: "echo",
      description: "echoes",
      params: z.object({ msg: z.string() }),
      handler: async ({ msg }) => `echo: ${msg}`,
    });

    const model = MockModel.create([
      { kind: "text", content: "Got the echo." },
    ]);
    const store = makeMemoryStore();

    const now = new Date().toISOString();
    const checkpointId = nanoid();
    const runId = nanoid();
    const adapter = new PersistenceAdapter(store);
    await adapter.saveSuspendedRun({
      runId,
      agentId: "agent",
      checkpointId,
      pendingApprovals: [
        {
          toolCallId: "e1",
          name: "echo",
          args: { msg: "hello" },
          agentName: "agent",
        },
      ],
      messages: [
        { role: "system", content: "Help." },
        { role: "user", content: "Echo hello" },
        {
          role: "assistant",
          content: "",
          toolCalls: [{ id: "e1", name: "echo", args: { msg: "hello" } }],
        },
      ],
      metadata: {},
      suspendedAt: now,
      createdAt: now,
      turns: 1,
      events: [],
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
    const toolMsg = result.messages.find((m) => m.role === "tool");
    expect(toolMsg?.content).toBe("echo: hello");
  });
});

// ---------------------------------------------------------------------------
// Resume with rejected decision
// ---------------------------------------------------------------------------

describe("continueRun — rejected decisions", () => {
  it("injects a synthetic rejection message and model recovers", async () => {
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

    const checkpointId = await writeSuspendFixture(store, {
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

    // Model should still complete after receiving the rejection context
    expect(result.status).toBe("complete");
    // The synthetic rejection message is added so the model sees it
    const toolMsg = result.messages.find((m) => m.role === "tool");
    expect(toolMsg?.content).toContain("rejected");
  });
});

// ---------------------------------------------------------------------------
// Missing decision — should throw CheckpointError
// ---------------------------------------------------------------------------

describe("continueRun — missing decision", () => {
  it("throws CheckpointError when no decision is provided for a pending approval", async () => {
    const model = MockModel.create([
      { kind: "text", content: "Never reached." },
    ]);
    const store = makeMemoryStore();

    const checkpointId = await writeSuspendFixture(store, {
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

  it("CheckpointError message names the missing tool call ID", async () => {
    const model = MockModel.create([]);
    const store = makeMemoryStore();

    const checkpointId = await writeSuspendFixture(store, {
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
});

// ---------------------------------------------------------------------------
// Missing checkpoint
// ---------------------------------------------------------------------------

describe("continueRun — checkpoint not found", () => {
  it("throws CheckpointError when checkpointId does not exist in the store", async () => {
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
