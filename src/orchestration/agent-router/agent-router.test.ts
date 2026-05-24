import { describe, it, expect } from "vitest";
import { AgentRouter } from "./agent-router.js";
import { RuleRouter } from "../strategies/rule/rule.js";
import { createAgent } from "../../agent/agent-builder.js";
import { MockModel } from "../../providers/model/mock/mock.js";
import { NO_OP_MEMORY, NO_OP_PRIVACY } from "../../providers/no-op/index.js";
import type { StoreProvider } from "../../contracts/store.js";
import type { RoutingDecisionRecord } from "../../types/records.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** In-memory store that records every write for assertion. */
function makeRecordingStore(): StoreProvider & {
  written: Map<string, unknown>;
} {
  const written = new Map<string, unknown>();
  return {
    written,
    async read<T>(key: string) {
      return (written.get(key) ?? null) as T | null;
    },
    async write(key: string, value: unknown) {
      written.set(key, value);
    },
    async remove(key: string) {
      written.delete(key);
    },
    async list() {
      return [];
    },
  };
}

function makeAgent(name: string, store?: StoreProvider) {
  const model = MockModel.create([
    { kind: "text", content: `Response from ${name}` },
  ]);
  return createAgent({
    name,
    systemPrompt: `You are ${name}.`,
    model,
    memory: NO_OP_MEMORY,
    store,
    privacy: NO_OP_PRIVACY,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AgentRouter — routing decision lineage", () => {
  it("sets routingDecisionId on child run results", async () => {
    const store = makeRecordingStore();
    const agent = makeAgent("ResearchAgent", store);

    const strategy = new RuleRouter().when(/research/i, agent).build();

    const router = AgentRouter.create()
      .add(agent)
      .withStrategy(strategy)
      .build();

    const result = await router.run("Please do some research for me.");

    expect(result.routingDecisionId).toBeDefined();
    expect(typeof result.routingDecisionId).toBe("string");
    expect(result.routingDecisionId!.length).toBeGreaterThan(0);
  });

  it("persists a RoutingDecisionRecord to the store", async () => {
    const store = makeRecordingStore();
    const agent = makeAgent("BillingAgent", store);

    const strategy = new RuleRouter().when(/invoice/i, agent).build();

    const router = AgentRouter.create()
      .add(agent)
      .withStrategy(strategy)
      .build();

    await router.run("Show me my invoice.");

    // Find the routing decision record written to the store
    const routingEntries = [...store.written.entries()].filter(([key]) =>
      key.includes("routing-decision"),
    );

    expect(routingEntries).toHaveLength(1);
    const [, record] = routingEntries[0];
    const decision = record as RoutingDecisionRecord;

    expect(decision.decisionId).toBeDefined();
    expect(decision.strategy).toBe("rule");
    expect(decision.inputMessage).toBe("Show me my invoice.");
    expect(decision.confidence).toBe(1);
    expect(decision.assignments).toHaveLength(1);
    expect(decision.assignments[0]).toMatchObject({
      agentName: "BillingAgent",
      parallel: false,
    });
    expect(decision.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("sets the same routingDecisionId in the persisted RunRecord", async () => {
    const store = makeRecordingStore();
    const agent = makeAgent("SupportAgent", store);

    const strategy = new RuleRouter().when(/support/i, agent).build();

    const router = AgentRouter.create()
      .add(agent)
      .withStrategy(strategy)
      .build();

    const result = await router.run("I need support.");
    const decisionId = result.routingDecisionId;

    expect(decisionId).toBeDefined();

    // RunRecord should reference the same decision
    const runEntries = [...store.written.entries()].filter(([key]) =>
      key.includes("run-record"),
    );
    expect(runEntries.length).toBeGreaterThan(0);

    const runRecord = runEntries[0][1] as { routingDecisionId?: string };
    expect(runRecord.routingDecisionId).toBe(decisionId);
  });

  it("does not fabricate parentRunId for child runs when no parent run record exists", async () => {
    const store = makeRecordingStore();
    const agent = makeAgent("SupportAgent", store);

    const strategy = new RuleRouter().when(/support/i, agent).build();

    const router = AgentRouter.create()
      .add(agent)
      .withStrategy(strategy)
      .build();

    await router.run("I need support.");

    const runEntries = [...store.written.entries()].filter(([key]) =>
      key.includes("run-record"),
    );
    const runRecord = runEntries[0][1] as { parentRunId?: string };
    expect(runRecord.parentRunId).toBeUndefined();
  });

  it("includes strategy field on RoutingDecision from RuleRouter", async () => {
    const agent = makeAgent("AgentA");
    const strategy = new RuleRouter().when(/test/i, agent).build();

    const decision = await strategy.route("test message");
    expect(decision.strategy).toBe("rule");
  });

  it("populates agentResults with all assignment results", async () => {
    const store = makeRecordingStore();
    const agent = makeAgent("GeneralAgent", store);

    const strategy = new RuleRouter().fallback(agent).build();

    const router = AgentRouter.create()
      .add(agent)
      .withStrategy(strategy)
      .build();

    const result = await router.run("Hello world.");

    expect(result.agentResults).toBeDefined();
    expect(result.agentResults!["GeneralAgent"]).toBeDefined();
    expect(result.agentResults!["GeneralAgent"].status).toBe("complete");
  });

  it("works when no store is configured (no persistence, no crash)", async () => {
    // Agent with NO_OP_STORE — adapter will be created but routing decisions are best-effort
    const agent = makeAgent("NoStoreAgent");

    const strategy = new RuleRouter().when(/hello/i, agent).build();

    const router = AgentRouter.create()
      .add(agent)
      .withStrategy(strategy)
      .build();

    // Should not throw
    const result = await router.run("hello there");
    expect(result.status).toBe("complete");
    expect(result.routingDecisionId).toBeDefined();
  });
});
