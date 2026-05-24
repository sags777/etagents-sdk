import { describe, expect, it } from "vitest";
import { createAgent } from "./agent-builder.js";
import { agentAsTool, Tool } from "./tool-builder.js";
import { MockModel } from "../providers/model/mock/mock.js";

describe("agentAsTool", () => {
  it("delegates to the child agent and returns its response", async () => {
    const delegate = createAgent({
      name: "research",
      systemPrompt: "Answer precisely.",
      model: MockModel.create([{ kind: "text", content: "Delegated answer." }]),
    });

    const tool = agentAsTool(delegate);

    expect(tool.name).toBe("research");
    expect(tool.description).toBe("Delegate to the research agent.");
    await expect(tool.handler({ input: "Summarize this topic." })).resolves.toBe(
      "Delegated answer.",
    );
  });

  it("exposes delegated agent tools from the tool builder", () => {
    const delegate = createAgent({
      name: "billing",
      systemPrompt: "Handle billing.",
      model: MockModel.create([]),
    });

    const tool = Tool.fromAgent(delegate, {
      name: "billing_delegate",
      description: "Escalate billing work.",
    });

    expect(tool.name).toBe("billing_delegate");
    expect(tool.description).toBe("Escalate billing work.");
  });
});