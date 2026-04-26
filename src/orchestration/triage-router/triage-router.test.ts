import { describe, it, expect } from "vitest";
import { TriageRouter } from "./triage-router.js";
import { MockModel } from "../../providers/model/mock/mock.js";
import type { AgentDef } from "../../types/agent.js";

// ---------------------------------------------------------------------------
// Minimal AgentDef stubs
// ---------------------------------------------------------------------------

function makeAgent(name: string): AgentDef {
  return {
    name,
    systemPrompt: `I am the ${name} agent.`,
    tools: [],
  } as unknown as AgentDef;
}

const researchAgent = makeAgent("ResearchAgent");
const billingAgent = makeAgent("BillingAgent");
const supportAgent = makeAgent("SupportAgent");

const agents = [researchAgent, billingAgent, supportAgent];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("TriageRouter", () => {
  describe("constructor", () => {
    it("throws when agents array is empty", () => {
      expect(
        () => new TriageRouter({ model: MockModel.create([]), agents: [] }),
      ).toThrow("agents array must not be empty");
    });
  });

  describe("route — model returns valid JSON", () => {
    it("routes to the named agent with correct confidence", async () => {
      const model = MockModel.create([
        {
          kind: "text",
          content: JSON.stringify({
            selectedAgent: "BillingAgent",
            confidence: 0.9,
            reason: "User asked about their invoice.",
          }),
        },
      ]);
      const router = new TriageRouter({ model, agents });
      const decision = await router.route("What is my invoice total?");

      expect(decision.assignments[0].agentDef.name).toBe("BillingAgent");
      expect(decision.confidence).toBe(0.9);
      expect(decision.reason).toContain("invoice");
    });

    it("clamps confidence to [0, 1]", async () => {
      const model = MockModel.create([
        {
          kind: "text",
          content: JSON.stringify({
            selectedAgent: "ResearchAgent",
            confidence: 1.5,
            reason: "High confidence.",
          }),
        },
      ]);
      const router = new TriageRouter({ model, agents });
      const decision = await router.route("Explain black holes");

      expect(decision.confidence).toBeLessThanOrEqual(1);
    });
  });

  describe("route — model returns unrecognised agent name", () => {
    it("falls back to first agent with confidence 0", async () => {
      const model = MockModel.create([
        {
          kind: "text",
          content: JSON.stringify({
            selectedAgent: "UnknownAgent",
            confidence: 0.8,
            reason: "Not sure.",
          }),
        },
      ]);
      const router = new TriageRouter({ model, agents });
      const decision = await router.route("Help me");

      expect(decision.assignments[0].agentDef.name).toBe(researchAgent.name);
      expect(decision.confidence).toBe(0);
    });
  });

  describe("route — model returns invalid JSON", () => {
    it("falls back to first agent with confidence 0", async () => {
      const model = MockModel.create([
        { kind: "text", content: "NOT JSON AT ALL" },
      ]);
      const router = new TriageRouter({ model, agents });
      const decision = await router.route("Anything");

      expect(decision.assignments[0].agentDef.name).toBe(researchAgent.name);
      expect(decision.confidence).toBe(0);
    });
  });

  describe("route — model call errors", () => {
    it("falls back to first agent on error response", async () => {
      const model = MockModel.create([
        { kind: "error", message: "API unavailable" },
      ]);
      const router = new TriageRouter({ model, agents });
      const decision = await router.route("Help");

      expect(decision.assignments[0].agentDef.name).toBe(researchAgent.name);
      expect(decision.confidence).toBe(0);
    });
  });

  describe("route — reason field", () => {
    it("defaults reason when model omits it", async () => {
      const model = MockModel.create([
        {
          kind: "text",
          content: JSON.stringify({ selectedAgent: "SupportAgent", confidence: 0.7 }),
        },
      ]);
      const router = new TriageRouter({ model, agents });
      const decision = await router.route("I need help");

      expect(typeof decision.reason).toBe("string");
      expect(decision.reason.length).toBeGreaterThan(0);
    });
  });
});
