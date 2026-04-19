import { describe, it, expect, vi } from "vitest";
import { routeTool } from "./tool-router.js";
import { ToolRegistry } from "../tool-registry/tool-registry.js";
import type { McpHub } from "../mcp-hub/mcp-hub.js";
import type { ToolContext } from "../../agent/executor/executor.js";
import { createAgent } from "../../agent/create-agent/create-agent.js";
import { defineTool } from "../../agent/define-tool/define-tool.js";
import { MockModel } from "../../providers/model/mock/mock.js";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeHub(overrides: Partial<McpHub> = {}): McpHub {
  return {
    tools: () => [],
    callTool: async () => "mcp-result",
    disconnect: async () => {},
    ...overrides,
  } as unknown as McpHub;
}

const ctx: ToolContext = { runId: "r1", agentName: "agent", messages: [] };

async function buildRegistry(tools: ReturnType<typeof defineTool>[]) {
  const agent = createAgent({
    name: "agent",
    systemPrompt: "test",
    model: MockModel.create([]),
    tools,
  });
  return ToolRegistry.build(agent, makeHub());
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("routeTool", () => {
  describe("local tool dispatch", () => {
    it("dispatches to the correct local handler", async () => {
      const greet = defineTool({
        name: "greet",
        description: "greets",
        params: z.object({ name: z.string() }),
        handler: async ({ name }) => `Hello, ${name}!`,
      });
      const registry = await buildRegistry([greet]);

      const result = await routeTool(
        { id: "c1", name: "greet", args: { name: "World" } },
        registry,
        makeHub(),
        ctx,
      );

      expect(result.isError).toBe(false);
      expect(result.content).toBe("Hello, World!");
      expect(result.toolCallId).toBe("c1");
    });

    it("returns isError:true for an unknown local tool", async () => {
      const registry = await buildRegistry([]);

      const result = await routeTool(
        { id: "c2", name: "nonexistent", args: {} },
        registry,
        makeHub(),
        ctx,
      );

      expect(result.isError).toBe(true);
      expect(result.content).toContain("nonexistent");
      expect(result.toolCallId).toBe("c2");
    });

    it("returns isError:true when local handler throws", async () => {
      const broken = defineTool({
        name: "broken",
        description: "throws",
        params: z.object({}),
        handler: async () => {
          throw new Error("tool exploded");
        },
      });
      const registry = await buildRegistry([broken]);

      const result = await routeTool(
        { id: "c3", name: "broken", args: {} },
        registry,
        makeHub(),
        ctx,
      );

      expect(result.isError).toBe(true);
    });
  });

  describe("MCP tool dispatch (name contains '::')", () => {
    it("routes to hub.callTool for MCP-namespaced names", async () => {
      const registry = await buildRegistry([]);
      const hub = makeHub({ callTool: async () => ({ answer: 42 }) });

      const result = await routeTool(
        { id: "c4", name: "myserver::myTool", args: { x: 1 } },
        registry,
        hub,
        ctx,
      );

      expect(result.isError).toBe(false);
      expect(result.content).toContain("42");
      expect(result.toolCallId).toBe("c4");
    });

    it("returns isError:true when hub.callTool throws", async () => {
      const registry = await buildRegistry([]);
      const hub = makeHub({
        callTool: async () => {
          throw new Error("MCP server down");
        },
      });

      const result = await routeTool(
        { id: "c5", name: "srv::tool", args: {} },
        registry,
        hub,
        ctx,
      );

      expect(result.isError).toBe(true);
      expect(result.content).toContain("MCP server down");
      expect(result.toolCallId).toBe("c5");
    });

    it("stringifies non-string MCP results", async () => {
      const registry = await buildRegistry([]);
      const hub = makeHub({ callTool: async () => ({ key: "value" }) });

      const result = await routeTool(
        { id: "c6", name: "srv::tool", args: {} },
        registry,
        hub,
        ctx,
      );

      expect(result.isError).toBe(false);
      expect(result.content).toBe(JSON.stringify({ key: "value" }));
    });
  });
});
