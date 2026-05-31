import { describe, expect, it } from "vitest";
import { exitCodeToStatus } from "./exit-code.js";

describe("exitCodeToStatus", () => {
  it("maps each internal exit code to the public run status", () => {
    expect(exitCodeToStatus("COMPLETE")).toBe("complete");
    expect(exitCodeToStatus("MAX_TURNS")).toBe("complete");
    expect(exitCodeToStatus("BUDGET")).toBe("budget_exceeded");
    expect(exitCodeToStatus("SUSPEND")).toBe("awaiting_approval");
    expect(exitCodeToStatus("ABORT")).toBe("cancelled");
  });
});