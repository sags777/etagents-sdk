import { describe, it, expect } from "vitest";
import { continueRun } from "./continue.js";
import { createAgent } from "../../agent/agent-builder.js";
import { defineTool } from "../../agent/tool-builder.js";
import { MockModel } from "../../providers/model/mock/mock.js";
import { PersistenceAdapter } from "../persist/persistence-adapter.js";
import { CheckpointError } from "../../errors.js";
import type { StoreProvider } from "../../contracts/store.js";
import { nanoid } from "nanoid";
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

async function writeSuspendFixture(
  store: StoreProvider,
  opts: { toolCallId?: string; toolName?: string; agentName?: string } = {},
): Promise<{ checkpointId: string; runId: string }> {
  const checkpointId = nanoid();
  const runId = nanoid();
  const toolCallId = opts.toolCallId ?? "tool-call-1";
  const toolName = opts.toolName ?? "action";
  const agentName = opts.agentName ?? "agent";
  const now = new Date().toISOString();

  await new PersistenceAdapter(store).saveSuspendedRun({
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

  return { checkpointId, runId };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("continueRun", () => {
  it("throws CheckpointError for an unknown checkpointId", async () => {
    const model = MockModel.create([]);
    const store = makeMemoryStore();

    await expect(
      continueRun("does-not-exist", [], {
        agent: createAgent({ name: "agent", systemPrompt: ".", model, store }),
      }),
    ).rejects.toThrow(CheckpointError);
  });

  it("resumes and returns complete status after an approved decision", async () => {
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

  it("returns rejected status when decision is not approved", async () => {
    const actionTool = defineTool({
      name: "action",
      description: "does something",
      params: z.object({}),
      handler: async () => "action executed",
    });

    const model = MockModel.create([{ kind: "text", content: "Understood." }]);
    const store = makeMemoryStore();

    const { checkpointId } = await writeSuspendFixture(store, {
      toolCallId: "call-2",
      toolName: "action",
      agentName: "agent",
    });

    const result = await continueRun(
      checkpointId,
      [{ toolCallId: "call-2", approved: false }],
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

    expect(result.status).toBe("complete");
  });
});
