import { describe, it, expect } from "vitest";
import { z } from "zod";
import { defineTool } from "./tool-builder.js";
import { executeTool } from "./tool-executor.js";
import type { ToolContext } from "../types/domain/tool.js";

// ---------------------------------------------------------------------------
// Shared test context
// ---------------------------------------------------------------------------

const ctx: ToolContext = {
  runId: "run-1",
  agentName: "test-agent",
  messages: [],
};

// ---------------------------------------------------------------------------
// executeTool - execution and error handling
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

    const result = await executeTool(tool, { n: "bad" }, ctx);
    expect(result.isError).toBe(true);
    expect(result.output).toMatch(/Invalid arguments/);
  });

  it("returns isError=true on timeout without throwing", async () => {
    const tool = defineTool({
      name: "slow",
      description: "never resolves",
      params: z.object({}),
      handler: () => new Promise<string>(() => {}),
      timeoutMs: 50,
    });

    const result = await executeTool(tool, {}, ctx);
    expect(result.isError).toBe(true);
    expect(result.output).toContain("timed out");
  }, 2000);
});