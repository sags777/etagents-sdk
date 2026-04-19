import { describe, it, expect } from "vitest";
import { runInsight } from "./extractor.js";
import { MockModel } from "../../providers/model/mock/mock.js";
import type { Message } from "../../types/message.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const conversation: Message[] = [
  { role: "user", content: "We're planning to migrate to a microservices architecture." },
  { role: "assistant", content: "Got it. What is your current setup?" },
  { role: "user", content: "A monolithic Node.js app. We chose Kubernetes for orchestration." },
  { role: "assistant", content: "Understood — Kubernetes is a solid choice for this migration." },
];

function makeModel(payload: object): MockModel {
  return MockModel.create([{ kind: "text", content: JSON.stringify(payload) }]);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runInsight", () => {
  it("returns an InsightResult with a non-empty facts array", async () => {
    const model = makeModel({
      facts: ["The team chose Kubernetes for container orchestration."],
      userFacts: ["The user is migrating a monolithic Node.js app."],
      summary: "The team decided to adopt Kubernetes as part of a microservices migration.",
      topics: ["kubernetes", "microservices", "migration"],
    });

    const result = await runInsight(conversation, model, {});

    expect(Array.isArray(result.facts)).toBe(true);
    expect(result.facts.length).toBeGreaterThan(0);
    expect(Array.isArray(result.userFacts)).toBe(true);
    expect(typeof result.summary).toBe("string");
    expect(result.summary.length).toBeGreaterThan(0);
    expect(Array.isArray(result.topics)).toBe(true);
  });

  it("deduplicates identical facts — same string appears only once", async () => {
    const repeated = "Kubernetes was selected as the container orchestration platform.";
    const model = makeModel({
      facts: [repeated, repeated, repeated],
      userFacts: [],
      summary: "Kubernetes selected.",
      topics: ["kubernetes"],
    });

    const result = await runInsight(conversation, model, {});

    const occurrences = result.facts.filter((f) => f === repeated).length;
    expect(occurrences).toBe(1);
  });

  it("deduplicates near-duplicate facts via edit distance", async () => {
    // Two facts that differ by only a few characters should collapse to one
    const a = "The team agreed to deploy on Kubernetes for orchestration purposes.";
    const b = "The team agreed to deploy on Kubernetes for orchestration purpose.";
    const model = makeModel({
      facts: [a, b],
      userFacts: [],
      summary: "Kubernetes chosen.",
      topics: [],
    });

    const result = await runInsight(conversation, model, {});

    // Near-duplicate — only one should survive
    expect(result.facts.length).toBe(1);
  });

  it("respects the maxFacts cap", async () => {
    const facts = Array.from(
      { length: 15 },
      (_, i) =>
        `Distinct architectural decision number ${i + 1} was made regarding component ${i * 7}.`,
    );
    const model = makeModel({
      facts,
      userFacts: [],
      summary: "Many distinct decisions.",
      topics: [],
    });

    const result = await runInsight(conversation, model, { maxFacts: 5 });

    expect(result.facts.length).toBeLessThanOrEqual(5);
  });

  it("returns empty arrays when the model errors — fail-open", async () => {
    const model = MockModel.create([{ kind: "error", message: "upstream model failed" }]);
    const result = await runInsight(conversation, model, {});

    expect(result.facts).toEqual([]);
    expect(result.userFacts).toEqual([]);
    expect(result.summary).toBe("");
    expect(result.topics).toEqual([]);
  });

  it("returns empty arrays when the model response is not valid JSON", async () => {
    const model = MockModel.create([
      { kind: "text", content: "Sorry, I cannot extract facts right now." },
    ]);
    const result = await runInsight(conversation, model, {});

    expect(result.facts).toEqual([]);
    expect(result.userFacts).toEqual([]);
  });

  it("keeps userFacts separate and unaffected by the facts cap", async () => {
    const facts = Array.from(
      { length: 10 },
      (_, i) => `Task outcome ${i + 1} was confirmed by the engineering lead.`,
    );
    const model = makeModel({
      facts,
      userFacts: ["The user is Sam, CTO of BuildCo."],
      summary: "Many decisions made.",
      topics: ["decisions"],
    });

    const result = await runInsight(conversation, model, { maxFacts: 3 });

    expect(result.facts.length).toBeLessThanOrEqual(3);
    expect(result.userFacts).toContain("The user is Sam, CTO of BuildCo.");
  });
});
