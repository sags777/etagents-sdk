import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { defineTool } from "./tool-builder.js";
import { executeTool } from "./tool-executor.js";
import type { ToolContext } from "../types/tool.js";

// ---------------------------------------------------------------------------
// Shared test context
// ---------------------------------------------------------------------------

const ctx: ToolContext = {
  runId: "run-1",
  agentName: "test-agent",
  messages: [],
};

// ---------------------------------------------------------------------------
// defineTool — schema conversion
// ---------------------------------------------------------------------------

describe("defineTool", () => {
  it("converts a Zod object schema to JsonSchema", () => {
    const tool = defineTool({
      name: "greet",
      description: "Greet a user",
      params: z.object({
        name: z.string().describe("The user's name"),
        age: z.number().optional(),
      }),
      handler: async ({ name }) => `Hello, ${name}`,
    });

    expect(tool.name).toBe("greet");
    expect(tool.description).toBe("Greet a user");
    expect(tool.schema).toMatchObject({
      type: "object",
      properties: {
        name: { type: "string", description: "The user's name" },
        age: { type: "number" },
      },
      required: ["name"],
    });
    // No $schema annotation in output
    expect(tool.schema).not.toHaveProperty("$schema");
  });

  it("maps sequential and timeoutMs to ToolDef fields", () => {
    const tool = defineTool({
      name: "slow",
      description: "A slow tool",
      params: z.object({ x: z.string() }),
      handler: async () => "done",
      sequential: true,
      timeoutMs: 5000,
    });

    expect(tool.sequential).toBe(true);
    expect(tool.timeout).toBe(5000);
  });

  it("produces a handler that calls the user handler with typed args", async () => {
    const spy = vi.fn().mockResolvedValue("ok");
    const tool = defineTool({
      name: "spy",
      description: "spy tool",
      params: z.object({ value: z.number() }),
      handler: spy,
    });

    await tool.handler({ value: 42 });
    // context is undefined when not passed — handler receives (args, undefined)
    expect(spy).toHaveBeenCalledWith({ value: 42 }, undefined);
  });

  it("produces a handler that throws ToolError on invalid args", async () => {
    const tool = defineTool({
      name: "strict",
      description: "strict tool",
      params: z.object({ count: z.number() }),
      handler: async ({ count }) => String(count),
    });

    await expect(tool.handler({ count: "not-a-number" })).rejects.toThrow(
      /Invalid arguments for tool "strict"/,
    );
  });
});

// ---------------------------------------------------------------------------
// executeTool — execution and error handling
// ---------------------------------------------------------------------------

describe("executeTool", () => {
  it("returns output and isError=false for a successful handler", async () => {
    const tool = defineTool({
      name: "echo",
      description: "echoes input",
      params: z.object({ msg: z.string() }),
      handler: async ({ msg }) => msg,
    });

    const result = await executeTool(tool, { msg: "hello" }, ctx);
    expect(result.output).toBe("hello");
    expect(result.isError).toBe(false);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("returns isError=true without throwing when handler throws", async () => {
    const tool = defineTool({
      name: "boom",
      description: "always throws",
      params: z.object({}),
      handler: async () => {
        throw new Error("deliberate failure");
      },
    });

    const result = await executeTool(tool, {}, ctx);
    expect(result.isError).toBe(true);
    expect(result.output).toContain("deliberate failure");
  });

  it("returns isError=true without throwing when args are invalid", async () => {
    const tool = defineTool({
      name: "typed",
      description: "needs a number",
      params: z.object({ n: z.number() }),
      handler: async ({ n }) => String(n),
    });

    // Pass a string for a number field — validation should fail inside handler
    const result = await executeTool(tool, { n: "bad" }, ctx);
    expect(result.isError).toBe(true);
    expect(result.output).toMatch(/Invalid arguments/);
  });

  it("returns isError=true on timeout without throwing", async () => {
    const tool = defineTool({
      name: "slow",
      description: "never resolves",
      params: z.object({}),
      handler: () => new Promise<string>(() => {}), // hangs forever
      timeoutMs: 50,
    });

    const result = await executeTool(tool, {}, ctx);
    expect(result.isError).toBe(true);
    expect(result.output).toContain("timed out");
  }, 2000);
});

// ---------------------------------------------------------------------------
// defineTool — cache config and TTL normalization
// ---------------------------------------------------------------------------

describe("defineTool — cache TTL normalization", () => {
  it("converts ttl (seconds) to ttlMs (milliseconds)", () => {
    const tool = defineTool({
      name: "cached-seconds",
      description: "uses ttl in seconds",
      params: z.object({}),
      handler: async () => "result",
      cache: { enabled: true, ttl: 60 },
    });

    expect(tool.cache?.ttlMs).toBe(60_000);
  });

  it("passes ttlMs through directly when no ttl is set", () => {
    const tool = defineTool({
      name: "cached-ms",
      description: "uses ttlMs directly",
      params: z.object({}),
      handler: async () => "result",
      cache: { enabled: true, ttlMs: 5_000 },
    });

    expect(tool.cache?.ttlMs).toBe(5_000);
  });

  it("ttl (seconds) takes precedence over ttlMs when both are provided", () => {
    const tool = defineTool({
      name: "cached-both",
      description: "both ttl and ttlMs set",
      params: z.object({}),
      handler: async () => "result",
      cache: { enabled: true, ttl: 10, ttlMs: 5_000 },
    });

    // ttl: 10s → 10_000ms, not the 5_000 from ttlMs
    expect(tool.cache?.ttlMs).toBe(10_000);
  });

  it("ttlMs is undefined when neither ttl nor ttlMs is set", () => {
    const tool = defineTool({
      name: "cached-no-ttl",
      description: "cache enabled but no TTL",
      params: z.object({}),
      handler: async () => "result",
      cache: { enabled: true },
    });

    expect(tool.cache?.ttlMs).toBeUndefined();
  });

  it("cache is undefined when not configured", () => {
    const tool = defineTool({
      name: "no-cache",
      description: "no cache at all",
      params: z.object({}),
      handler: async () => "result",
    });

    expect(tool.cache).toBeUndefined();
  });

  it("cache.enabled is preserved in the output ToolDef", () => {
    const tool = defineTool({
      name: "enabled-cache",
      description: "cache enabled",
      params: z.object({}),
      handler: async () => "result",
      cache: { enabled: true, ttlMs: 1_000 },
    });

    expect(tool.cache?.enabled).toBe(true);
  });

  it("cache.enabled false is preserved in the output ToolDef", () => {
    const tool = defineTool({
      name: "disabled-cache",
      description: "cache disabled",
      params: z.object({}),
      handler: async () => "result",
      cache: { enabled: false },
    });

    expect(tool.cache?.enabled).toBe(false);
  });
});
