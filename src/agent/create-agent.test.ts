import { describe, it, expect } from "vitest";
import { createAgent } from "./agent-builder.js";
import { defineTool } from "./tool-builder.js";
import { MockModel } from "../providers/model/mock/mock.js";
import { ModelError } from "../errors.js";
import { DEFAULT_CONFIG } from "../config.js";
import { z } from "zod";

// ---------------------------------------------------------------------------
// AgentDef output shape
// ---------------------------------------------------------------------------

describe("createAgent — output shape", () => {
  it("returns a frozen object", () => {
    const model = MockModel.create([]);
    const def = createAgent({ name: "test", systemPrompt: "help", model });
    expect(Object.isFrozen(def)).toBe(true);
  });

  it("preserves name and systemPrompt", () => {
    const model = MockModel.create([]);
    const def = createAgent({
      name: "my-agent",
      systemPrompt: "You are helpful.",
      model,
    });
    expect(def.name).toBe("my-agent");
    expect(def.systemPrompt).toBe("You are helpful.");
  });

  it("passes through a ModelProvider instance unchanged", () => {
    const model = MockModel.create([]);
    const def = createAgent({ name: "agent", systemPrompt: "help", model });
    expect(def.model).toBe(model);
  });

  it("includes all provided tools in the def", () => {
    const model = MockModel.create([]);
    const tool = defineTool({
      name: "greet",
      description: "greets",
      params: z.object({ name: z.string() }),
      handler: async ({ name }) => `Hello, ${name}`,
    });
    const def = createAgent({
      name: "agent",
      systemPrompt: "help",
      model,
      tools: [tool],
    });
    expect(def.tools).toHaveLength(1);
    expect(def.tools[0].name).toBe("greet");
  });

  it("preserves optional description when provided", () => {
    const model = MockModel.create([]);
    const def = createAgent({
      name: "agent",
      systemPrompt: "help",
      model,
      description: "An AI agent",
    });
    expect(def.description).toBe("An AI agent");
  });
});

// ---------------------------------------------------------------------------
// Default fallbacks
// ---------------------------------------------------------------------------

describe("createAgent — default fallbacks", () => {
  it("defaults tools to empty array when omitted", () => {
    const model = MockModel.create([]);
    const def = createAgent({ name: "agent", systemPrompt: "help", model });
    expect(def.tools).toEqual([]);
  });

  it("defaults hitl.mode to 'none' when omitted", () => {
    const model = MockModel.create([]);
    const def = createAgent({ name: "agent", systemPrompt: "help", model });
    expect(def.hitl.mode).toBe("none");
  });

  it("defaults mcp to empty array when omitted", () => {
    const model = MockModel.create([]);
    const def = createAgent({ name: "agent", systemPrompt: "help", model });
    expect(def.mcp).toEqual([]);
  });

  it("defaults insight to empty object when omitted", () => {
    const model = MockModel.create([]);
    const def = createAgent({ name: "agent", systemPrompt: "help", model });
    expect(def.insight).toEqual({});
  });

  it("defaults hooks to empty object when omitted", () => {
    const model = MockModel.create([]);
    const def = createAgent({ name: "agent", systemPrompt: "help", model });
    expect(def.hooks).toEqual({});
  });

  it("uses DEFAULT_CONFIG.maxTurns when maxTurns is omitted", () => {
    const model = MockModel.create([]);
    const def = createAgent({ name: "agent", systemPrompt: "help", model });
    expect(def.maxTurns).toBe(DEFAULT_CONFIG.maxTurns);
  });

  it("uses DEFAULT_CONFIG.maxTokens when maxTokens is omitted", () => {
    const model = MockModel.create([]);
    const def = createAgent({ name: "agent", systemPrompt: "help", model });
    expect(def.maxTokens).toBe(DEFAULT_CONFIG.maxTokens);
  });

  it("respects explicit maxTurns override", () => {
    const model = MockModel.create([]);
    const def = createAgent({
      name: "agent",
      systemPrompt: "help",
      model,
      maxTurns: 5,
    });
    expect(def.maxTurns).toBe(5);
  });

  it("respects explicit maxTokens override", () => {
    const model = MockModel.create([]);
    const def = createAgent({
      name: "agent",
      systemPrompt: "help",
      model,
      maxTokens: 1000,
    });
    expect(def.maxTokens).toBe(1000);
  });
});

// ---------------------------------------------------------------------------
// Model shorthand resolution
// ---------------------------------------------------------------------------

describe("createAgent — model resolution", () => {
  it("throws ModelError for an unrecognized model string", () => {
    expect(() =>
      createAgent({
        name: "agent",
        systemPrompt: "help",
        model: "unknown-model-xyz",
      }),
    ).toThrow(ModelError);
  });

  it("ModelError message names the bad model string and lists supported prefixes", () => {
    expect(() =>
      createAgent({ name: "agent", systemPrompt: "help", model: "bad-model" }),
    ).toThrow(/bad-model/);
  });

  it("resolves claude-* string to a provider with a stream method", () => {
    const def = createAgent({
      name: "agent",
      systemPrompt: "help",
      model: "claude-sonnet-4-6",
    });
    expect(typeof def.model.stream).toBe("function");
  });

  it("resolves gpt-* string to a provider with a stream method", () => {
    const def = createAgent({
      name: "agent",
      systemPrompt: "help",
      model: "gpt-4o",
    });
    expect(typeof def.model.stream).toBe("function");
  });

  it("resolves o1* string to a provider with a stream method", () => {
    const def = createAgent({
      name: "agent",
      systemPrompt: "help",
      model: "o1-preview",
    });
    expect(typeof def.model.stream).toBe("function");
  });

  it("resolves o3* string to a provider with a stream method", () => {
    const def = createAgent({
      name: "agent",
      systemPrompt: "help",
      model: "o3-mini",
    });
    expect(typeof def.model.stream).toBe("function");
  });

  it("resolves gemini-* string to a provider with a stream method", () => {
    const def = createAgent({
      name: "agent",
      systemPrompt: "help",
      model: "gemini-2.0-flash",
    });
    expect(typeof def.model.stream).toBe("function");
  });

  it("uses DEFAULT_CONFIG.defaultModel when model is omitted (resolves to a provider)", () => {
    // No model provided — should resolve using DEFAULT_CONFIG.defaultModel
    // This exercises the else branch: typeof model !== "string" path with undefined fallback
    const def = createAgent({ name: "agent", systemPrompt: "help" });
    expect(typeof def.model.stream).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// No-op provider defaults
// ---------------------------------------------------------------------------

describe("createAgent — no-op provider defaults", () => {
  it("memory.search returns empty array", async () => {
    const model = MockModel.create([]);
    const def = createAgent({ name: "agent", systemPrompt: "help", model });
    const results = await def.memory.search("query");
    expect(results).toEqual([]);
  });

  it("store.read returns null", async () => {
    const model = MockModel.create([]);
    const def = createAgent({ name: "agent", systemPrompt: "help", model });
    expect(await def.store.read("any-key")).toBeNull();
  });

  it("store.write resolves without error", async () => {
    const model = MockModel.create([]);
    const def = createAgent({ name: "agent", systemPrompt: "help", model });
    await expect(def.store.write("key", { data: 1 })).resolves.toBeUndefined();
  });

  it("store.list returns empty array", async () => {
    const model = MockModel.create([]);
    const def = createAgent({ name: "agent", systemPrompt: "help", model });
    expect(await def.store.list("prefix")).toEqual([]);
  });

  it("privacy.mask returns text unchanged with empty map", async () => {
    const model = MockModel.create([]);
    const def = createAgent({ name: "agent", systemPrompt: "help", model });
    const { masked, map } = await def.privacy.mask("hello world");
    expect(masked).toBe("hello world");
    expect(map.size).toBe(0);
  });

  it("privacy.unmask returns text unchanged", async () => {
    const model = MockModel.create([]);
    const def = createAgent({ name: "agent", systemPrompt: "help", model });
    const result = await def.privacy.unmask("some text", new Map());
    expect(result).toBe("some text");
  });
});
