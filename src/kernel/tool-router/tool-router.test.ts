import { describe, it, expect } from "vitest";
import { routeTool } from "./tool-router.js";
import { ToolRegistry } from "../tool-registry/tool-registry.js";
import type { McpHub } from "../mcp-hub/mcp-hub.js";
import type { ToolContext } from "../../types/tool.js";
import { createAgent } from "../../agent/agent-builder.js";
import { defineTool } from "../../agent/tool-builder.js";
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

const ctx: ToolContext = {
  runId: "r1",
  agentName: "agent",
  agentId: "agent-1",
  messages: [],
};

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

  describe("MCP tool dispatch (name starts with 'mcp__')", () => {
    it("routes to hub.callTool for MCP-namespaced names", async () => {
      const registry = await buildRegistry([]);
      const hub = makeHub({ callTool: async () => ({ answer: 42 }) });

      const result = await routeTool(
        { id: "c4", name: "mcp__myserver__myTool", args: { x: 1 } },
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
        { id: "c5", name: "mcp__srv__tool", args: {} },
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
        { id: "c6", name: "mcp__srv__tool", args: {} },
        registry,
        hub,
        ctx,
      );

      expect(result.isError).toBe(false);
      expect(result.content).toBe(JSON.stringify({ key: "value" }));
    });
  });
});

// ---------------------------------------------------------------------------
// Cache key scoping — 0C characterization
// ---------------------------------------------------------------------------

describe("tool cache key scoping (0C)", () => {
  it("two agents with identical display name + args still get isolated cache entries when agentId differs", async () => {
    // toolCacheKey is scoped by stable agentId so different logical agents never
    // share a cache entry even when tool name and args are identical.
    const cachingTool = defineTool({
      name: "shared",
      description: "shared tool",
      params: z.object({ v: z.number() }),
      handler: async ({ v }) => `val-${v}`,
      cache: { enabled: true },
    });

    const map = new Map<string, unknown>();
    const store: ToolContext["store"] = {
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

    const registry = await buildRegistry([cachingTool]);

    const ctxAgent1: ToolContext = {
      runId: "r1",
      agentName: "shared-name",
      agentId: "agent-alpha",
      messages: [],
      store,
    };
    const ctxAgent2: ToolContext = {
      runId: "r2",
      agentName: "shared-name",
      agentId: "agent-beta",
      messages: [],
      store,
    };

    await routeTool(
      { id: "c1", name: "shared", args: { v: 1 } },
      registry,
      makeHub(),
      ctxAgent1,
    );
    // Agent-beta uses the same shared store and display name but a different
    // stable identity — the handler must execute again.
    // handler must execute again (no cache hit from agent-alpha's entry).
    const keysBeforeAgent2 = map.size;
    await routeTool(
      { id: "c2", name: "shared", args: { v: 1 } },
      registry,
      makeHub(),
      ctxAgent2,
    );

    // Two distinct cache entries were written — one per agent.
    expect(map.size).toBe(keysBeforeAgent2 + 1);
  });

  it("same stable agentId keeps a cache hit even if the display name changes", async () => {
    const cachingTool = defineTool({
      name: "cached",
      description: "cached tool",
      params: z.object({ x: z.number() }),
      handler: async ({ x }) => `result-${x}`,
      cache: { enabled: true },
    });

    const store: ToolContext["store"] = (() => {
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
    })();

    const registry = await buildRegistry([cachingTool]);
    const firstCtx: ToolContext = {
      ...ctx,
      agentName: "original-name",
      agentId: "stable-agent-id",
      store,
    };
    const renamedCtx: ToolContext = {
      ...ctx,
      agentName: "renamed-agent",
      agentId: "stable-agent-id",
      store,
    };

    // First call — should execute and cache the result
    const first = await routeTool(
      { id: "c1", name: "cached", args: { x: 42 } },
      registry,
      makeHub(),
      firstCtx,
    );

    // Second call with same args — should hit cache
    const second = await routeTool(
      { id: "c2", name: "cached", args: { x: 42 } },
      registry,
      makeHub(),
      renamedCtx,
    );

    expect(first.isError).toBe(false);
    expect(second.isError).toBe(false);
    expect(first.content).toBe(second.content);
  });

  it("same tool name but different args produce different results (cache miss)", async () => {
    const cachingTool = defineTool({
      name: "vary",
      description: "result varies by input",
      params: z.object({ n: z.number() }),
      handler: async ({ n }) => `result-${n}`,
      cache: { enabled: true },
    });

    const store: ToolContext["store"] = (() => {
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
    })();

    const registry = await buildRegistry([cachingTool]);
    const ctxWithStore: ToolContext = { ...ctx, store };

    const a = await routeTool(
      { id: "c1", name: "vary", args: { n: 1 } },
      registry,
      makeHub(),
      ctxWithStore,
    );
    const b = await routeTool(
      { id: "c2", name: "vary", args: { n: 2 } },
      registry,
      makeHub(),
      ctxWithStore,
    );

    expect(a.content).toBe("result-1");
    expect(b.content).toBe("result-2");
  });
});
