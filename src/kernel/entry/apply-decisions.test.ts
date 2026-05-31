import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createAgent } from "../../agent/agent-builder.js";
import { defineTool } from "../../agent/tool-builder.js";
import { MockModel } from "../../providers/model/mock/mock.js";
import type { RunState } from "../../types/domain/run.js";
import type { ToolContext } from "../../types/domain/tool.js";
import { McpHub } from "../mcp-hub/mcp-hub.js";
import { ToolRegistry } from "../tool-registry/tool-registry.js";
import { applyDecisions } from "./apply-decisions.js";

describe("applyDecisions", () => {
  it("executes approved tool calls and appends the tool result message", async () => {
    const echoTool = defineTool({
      name: "echo",
      description: "echoes input",
      params: z.object({ msg: z.string() }),
      handler: async ({ msg }) => `echo: ${msg}`,
    });
    const agent = createAgent({
      name: "agent",
      systemPrompt: ".",
      model: MockModel.create([]),
      tools: [echoTool],
    });
    const hub = await McpHub.connect([]);

    try {
      const registry = await ToolRegistry.build(agent, hub);
      const state: RunState = { messages: [], toolCallRecords: [], turns: 0 };
      const toolContext: ToolContext = {
        runId: "run-1",
        agentName: agent.name,
        agentId: agent.agentId,
        messages: state.messages,
        store: agent.store,
        metadata: {},
      };

      await applyDecisions(
        [
          {
            toolCallId: "call-1",
            name: "echo",
            args: { msg: "hi" },
            agentName: agent.name,
          },
        ],
        [{ toolCallId: "call-1", approved: true }],
        state,
        registry,
        hub,
        toolContext,
      );

      expect(state.messages).toEqual([
        { role: "tool", content: "echo: hi", toolCallId: "call-1" },
      ]);
    } finally {
      await hub.disconnect();
    }
  });

  it("injects a synthetic rejection message for denied approvals", async () => {
    const agent = createAgent({
      name: "agent",
      systemPrompt: ".",
      model: MockModel.create([]),
    });
    const hub = await McpHub.connect([]);

    try {
      const registry = await ToolRegistry.build(agent, hub);
      const state: RunState = { messages: [], toolCallRecords: [], turns: 0 };
      const toolContext: ToolContext = {
        runId: "run-1",
        agentName: agent.name,
        agentId: agent.agentId,
        messages: state.messages,
        store: agent.store,
        metadata: {},
      };

      await applyDecisions(
        [
          {
            toolCallId: "call-2",
            name: "danger",
            args: { amount: 100 },
            agentName: agent.name,
          },
        ],
        [{ toolCallId: "call-2", approved: false }],
        state,
        registry,
        hub,
        toolContext,
      );

      expect(state.messages).toEqual([
        {
          role: "tool",
          content: "Tool call rejected by human reviewer.",
          toolCallId: "call-2",
        },
      ]);
    } finally {
      await hub.disconnect();
    }
  });
});