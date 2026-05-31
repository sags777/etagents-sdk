import { describe, expect, it, vi } from "vitest";
import { createAgent } from "../../agent/agent-builder.js";
import { InMemory } from "../../providers/memory/in-memory/in-memory.js";
import { MockModel } from "../../providers/model/mock/mock.js";
import type { RunState } from "../../types/domain/run.js";
import { MemoryPipe } from "../memory-pipe/memory-pipe.js";
import { sessionInsight } from "./session-insight.js";

describe("sessionInsight", () => {
  it("returns extracted insights and indexes facts, user facts, and topics", async () => {
    const model = MockModel.create([
      {
        kind: "text",
        content:
          '{"facts":["fact 1"],"userFacts":["user 1"],"summary":"summary 1","topics":["topic 1"]}',
      },
    ]);
    const agent = createAgent({
      name: "agent",
      systemPrompt: ".",
      model,
      insight: { maxFacts: 5 },
    });
    const pipe = MemoryPipe.create(
      new InMemory(),
      { agentId: agent.agentId, namespace: "default" },
      agent.model,
    );
    const indexSpy = vi.spyOn(pipe, "index");
    const state: RunState = {
      messages: [
        { role: "user", content: "Hi" },
        { role: "assistant", content: "Hello" },
      ],
      toolCallRecords: [],
      turns: 1,
    };

    const result = await sessionInsight(state, agent, pipe);

    expect(result).toEqual({
      facts: ["fact 1"],
      userFacts: ["user 1"],
      summary: "summary 1",
      topics: ["topic 1"],
    });
    expect(indexSpy).toHaveBeenCalledWith([
      { text: "fact 1", kind: "fact" },
      { text: "user 1", kind: "user_fact" },
      { text: "topic 1", kind: "topic" },
    ]);
  });

  it("indexes only the summary when injectSummaryOnly is enabled", async () => {
    const model = MockModel.create([
      {
        kind: "text",
        content:
          '{"facts":["fact 1"],"userFacts":["user 1"],"summary":"summary 1","topics":["topic 1"]}',
      },
    ]);
    const agent = createAgent({
      name: "agent",
      systemPrompt: ".",
      model,
      insight: { maxFacts: 5, injectSummaryOnly: true },
    });
    const pipe = MemoryPipe.create(
      new InMemory(),
      { agentId: agent.agentId, namespace: "default" },
      agent.model,
    );
    const indexSpy = vi.spyOn(pipe, "index");
    const state: RunState = {
      messages: [
        { role: "user", content: "Hi" },
        { role: "assistant", content: "Hello" },
      ],
      toolCallRecords: [],
      turns: 1,
    };

    await sessionInsight(state, agent, pipe);

    expect(indexSpy).toHaveBeenCalledWith([
      { text: "summary 1", kind: "summary" },
    ]);
  });

  it("returns an empty insight result when extraction fails", async () => {
    const model = MockModel.create([{ kind: "text", content: "not json" }]);
    const agent = createAgent({
      name: "agent",
      systemPrompt: ".",
      model,
      insight: { maxFacts: 5 },
    });
    const pipe = MemoryPipe.create(
      new InMemory(),
      { agentId: agent.agentId, namespace: "default" },
      agent.model,
    );
    const indexSpy = vi.spyOn(pipe, "index");
    const state: RunState = {
      messages: [
        { role: "user", content: "Hi" },
        { role: "assistant", content: "Hello" },
      ],
      toolCallRecords: [],
      turns: 1,
    };

    const result = await sessionInsight(state, agent, pipe);

    expect(result).toEqual({ facts: [], userFacts: [], summary: "", topics: [] });
    expect(indexSpy).toHaveBeenCalledWith([]);
  });
});