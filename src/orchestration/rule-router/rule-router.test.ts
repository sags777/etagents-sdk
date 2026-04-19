import { describe, it, expect } from "vitest";
import { RuleRouter } from "./rule-router.js";
import { MockModel } from "../../providers/model/mock/mock.js";
import type { AgentDef } from "../../types/agent.js";

// ---------------------------------------------------------------------------
// Minimal AgentDef factory for tests — no real providers, no API calls
// ---------------------------------------------------------------------------

function makeAgent(name: string, systemPrompt = `You are ${name}.`): AgentDef {
  const model = MockModel.create([]);

  const noopMemory = {
    async index() {},
    async search() { return []; },
    async delete() {},
    async clear() {},
  };

  const noopStore = {
    async read() { return null; },
    async write() {},
    async remove() {},
    async list() { return []; },
  };

  const noopPrivacy = {
    async mask(text: string) { return { masked: text, map: new Map<string, string>() }; },
    async unmask(text: string) { return text; },
    async encryptMap(m: Map<string, string>) { return { iv: "", ciphertext: JSON.stringify([...m]) }; },
    async decryptMap(enc: { iv: string; ciphertext: string }) {
      return new Map<string, string>(JSON.parse(enc.ciphertext) as [string, string][]);
    },
  };

  return {
    name,
    systemPrompt,
    tools: [],
    model,
    memory: noopMemory,
    store: noopStore,
    privacy: noopPrivacy,
    insight: {},
    hitl: { mode: "none" },
    hooks: {},
    mcp: [],
    maxTurns: 10,
    maxTokens: 4096,
  } as AgentDef;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("RuleRouter", () => {
  const billingAgent = makeAgent("BillingAgent");
  const supportAgent = makeAgent("SupportAgent");
  const generalAgent = makeAgent("GeneralAgent");

  it("matches the correct agent for a RegExp pattern", async () => {
    const strategy = new RuleRouter()
      .when(/\binvoice\b/i, billingAgent)
      .when(/\bticket\b/i, supportAgent)
      .fallback(generalAgent)
      .build();

    const decision = await strategy.route("Please resend my invoice from last month.");
    expect(decision.agentDef).toBe(billingAgent);
    expect(decision.confidence).toBe(1);
  });

  it("matches the correct agent for a literal string pattern", async () => {
    const strategy = new RuleRouter()
      .when("billing", billingAgent)
      .when("support ticket", supportAgent)
      .fallback(generalAgent)
      .build();

    const decision = await strategy.route("I need help with a support ticket.");
    expect(decision.agentDef).toBe(supportAgent);
    expect(decision.confidence).toBe(1);
  });

  it("routes to the fallback agent when no pattern matches", async () => {
    const strategy = new RuleRouter()
      .when(/\binvoice\b/i, billingAgent)
      .fallback(generalAgent)
      .build();

    const decision = await strategy.route("What is the weather like today?");
    expect(decision.agentDef).toBe(generalAgent);
    expect(decision.confidence).toBe(0.5);
  });

  it("returns a RoutingDecision with the correct agentDef shape", async () => {
    const strategy = new RuleRouter()
      .when(/billing/i, billingAgent)
      .fallback(generalAgent)
      .build();

    const decision = await strategy.route("Billing inquiry about my account.");
    expect(decision).toHaveProperty("agentDef");
    expect(decision).toHaveProperty("confidence");
    expect(decision).toHaveProperty("reason");
    expect(typeof decision.reason).toBe("string");
    expect(decision.agentDef.name).toBe("BillingAgent");
  });

  it("throws when no rule matches and no fallback is configured", async () => {
    const strategy = new RuleRouter()
      .when(/\binvoice\b/i, billingAgent)
      .build();

    await expect(strategy.route("Completely unrelated message.")).rejects.toThrow(
      /no rule matched/i,
    );
  });

  it("evaluates rules in insertion order — first match wins", async () => {
    const strategy = new RuleRouter()
      .when(/order/i, billingAgent)   // matches "order" first
      .when(/order support/i, supportAgent)
      .fallback(generalAgent)
      .build();

    // Both patterns match, but the first one wins
    const decision = await strategy.route("I have a question about my order support case.");
    expect(decision.agentDef).toBe(billingAgent);
  });

  it("throws if when() is called after build()", () => {
    const router = new RuleRouter();
    router.build();
    expect(() => router.when(/test/, billingAgent)).toThrow(/after build/i);
  });
});
