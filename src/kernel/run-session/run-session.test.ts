import { describe, expect, it } from "vitest";
import { createAgent } from "../../agent/agent-builder.js";
import { CheckpointError } from "../../lib/errors.js";
import { MockModel } from "../../providers/model/mock/mock.js";
import { RunSession } from "./run-session.js";

describe("RunSession", () => {
  it("starts idle and updates status and messages after a successful run", async () => {
    const agent = createAgent({
      name: "agent",
      systemPrompt: ".",
      model: MockModel.create([{ kind: "text", content: "Hello there" }]),
    });
    const session = await RunSession.create(agent);

    expect(session.status).toBe("IDLE");
    expect(session.messages).toEqual([]);

    const result = await session.run("Hi");

    expect(result.status).toBe("complete");
    expect(session.status).toBe("COMPLETED");
    expect(session.messages).toEqual(result.messages);
    expect(session.runId.length).toBeGreaterThan(0);
  });

  it("returns cancelled and ends aborted when abort() is called before run()", async () => {
    const agent = createAgent({
      name: "agent",
      systemPrompt: ".",
      model: MockModel.create([{ kind: "text", content: "Too late" }]),
    });
    const session = await RunSession.create(agent);

    session.abort();

    const result = await session.run("Hi");

    expect(result.status).toBe("cancelled");
    expect(session.status).toBe("ABORTED");
  });

  it("throws CheckpointError when resume() is called without a restore snapshot", async () => {
    const agent = createAgent({
      name: "agent",
      systemPrompt: ".",
      model: MockModel.create([]),
    });
    const session = await RunSession.create(agent);

    await expect(session.resume("checkpoint-1", [])).rejects.toThrow(
      CheckpointError,
    );
    expect(session.status).toBe("IDLE");
  });

  it("rejects a second run after the session has already completed", async () => {
    const agent = createAgent({
      name: "agent",
      systemPrompt: ".",
      model: MockModel.create([{ kind: "text", content: "Done" }]),
    });
    const session = await RunSession.create(agent);

    await session.run("Hi");

    await expect(session.run("Again")).rejects.toThrow(
      /RunSession\.run\(\) called in invalid state: COMPLETED/,
    );
  });
});