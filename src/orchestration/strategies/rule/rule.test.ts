import { describe, it, expect } from "vitest";
import { RuleRouter } from "./rule.js";
import { MockModel } from "../../../providers/model/mock/mock.js";
import type { AgentDef } from "../../../types/domain/agent.js";
import {
  NO_OP_MEMORY,
  NO_OP_STORE,
  NO_OP_PRIVACY,
} from "../../../providers/no-op/index.js";

// ---------------------------------------------------------------------------
// Minimal AgentDef factory for tests — no real providers, no API calls
// ---------------------------------------------------------------------------

function makeAgent(name: string, systemPrompt = `You are ${name}.`): AgentDef {
  const model = MockModel.create([]);

  return {
    agentId: `mock-agent-id-${name}`,
    name,
    systemPrompt,
    systemPromptHash: "mock-hash",
    tools: [],
    model,
    memory: NO_OP_MEMORY,
    store: NO_OP_STORE,
    privacy: NO_OP_PRIVACY,
    insight: {},
    hitl: { mode: "none" },
    hooks: {},
    mcp: [],
    maxTurns: 10,
    maxTokens: 4096,
    memoryRetrieval: { minScore: 0.7 },
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

    const decision = await strategy.route(
      "Please resend my invoice from last month.",
    );
    expect(decision.assignments[0].agentDef).toBe(billingAgent);
    expect(decision.confidence).toBe(1);
  });

  it("matches the correct agent for a literal string pattern", async () => {
    const strategy = new RuleRouter()
      .when("billing", billingAgent)
      .when("support ticket", supportAgent)
      .fallback(generalAgent)
      .build();

    const decision = await strategy.route("I need help with a support ticket.");
    expect(decision.assignments[0].agentDef).toBe(supportAgent);
    expect(decision.confidence).toBe(1);
  });

  it("routes to the fallback agent when no pattern matches", async () => {
    const strategy = new RuleRouter()
      .when(/\binvoice\b/i, billingAgent)
      .fallback(generalAgent)
      .build();

    const decision = await strategy.route("What is the weather like today?");
    expect(decision.assignments[0].agentDef).toBe(generalAgent);
    expect(decision.confidence).toBe(0.5);
  });

  it("returns a RoutingDecision with the correct agentDef shape", async () => {
    const strategy = new RuleRouter()
      .when(/billing/i, billingAgent)
      .fallback(generalAgent)
      .build();

    const decision = await strategy.route("Billing inquiry about my account.");
    expect(decision).toHaveProperty("assignments");
    expect(decision).toHaveProperty("confidence");
    expect(decision).toHaveProperty("reason");
    expect(typeof decision.reason).toBe("string");
    expect(decision.assignments[0].agentDef.name).toBe("BillingAgent");
  });

  it("throws when no rule matches and no fallback is configured", async () => {
    const strategy = new RuleRouter()
      .when(/\binvoice\b/i, billingAgent)
      .build();

    await expect(
      strategy.route("Completely unrelated message."),
    ).rejects.toThrow(/no rule matched/i);
  });

  it("evaluates rules in insertion order — first match wins", async () => {
    const strategy = new RuleRouter()
      .when(/order/i, billingAgent) // matches "order" first
      .when(/order support/i, supportAgent)
      .fallback(generalAgent)
      .build();

    // Both patterns match, but the first one wins
    const decision = await strategy.route(
      "I have a question about my order support case.",
    );
    expect(decision.assignments[0].agentDef).toBe(billingAgent);
  });

  it("throws if when() is called after build()", () => {
    const router = new RuleRouter();
    router.build();
    expect(() => router.when(/test/, billingAgent)).toThrow(/after build/i);
  });
});
