import { describe, expect, it } from "vitest";
import { STORE_KEYS } from "../lib/constants.js";
import {
  agentPromptKey,
  approvalsKey,
  checkpointRecordKey,
  memoryKey,
  messagesKey,
  routingDecisionKey,
  runEventsKey,
  runKey,
  runRecordKey,
  storeKey,
  suspendKey,
  toolCacheKey,
  toolCallsKey,
} from "./keys.js";

describe("kernel key builders", () => {
  it("builds the expected prefixes for persisted entities", () => {
    expect(runKey("run-1")).toBe(`${STORE_KEYS.SESSION_PREFIX}run-1`);
    expect(suspendKey("checkpoint-1")).toBe(
      `${STORE_KEYS.SUSPEND_PREFIX}checkpoint-1`,
    );
    expect(memoryKey("agent", "agent-1", "default", "memory-1")).toBe(
      `${STORE_KEYS.MEMORY_PREFIX}agent:agent-1:default:memory-1`,
    );
    expect(storeKey("agent", "cache")).toBe(`${STORE_KEYS.STORE_PREFIX}agent:cache`);
    expect(runRecordKey("run-1")).toBe(`${STORE_KEYS.RUN_RECORD_PREFIX}run-1`);
    expect(checkpointRecordKey("checkpoint-1")).toBe(
      `${STORE_KEYS.CHECKPOINT_PREFIX}checkpoint-1`,
    );
    expect(messagesKey("run-1")).toBe(`${STORE_KEYS.MESSAGES_PREFIX}run-1`);
    expect(approvalsKey("checkpoint-1")).toBe(
      `${STORE_KEYS.APPROVALS_PREFIX}checkpoint-1`,
    );
    expect(routingDecisionKey("decision-1")).toBe(
      `${STORE_KEYS.ROUTING_DECISION_PREFIX}decision-1`,
    );
    expect(toolCallsKey("run-1")).toBe(`${STORE_KEYS.TOOL_CALLS_PREFIX}run-1`);
    expect(runEventsKey("run-1")).toBe(`${STORE_KEYS.RUN_EVENTS_PREFIX}run-1`);
    expect(agentPromptKey("prompt-hash")).toBe(
      `${STORE_KEYS.AGENT_PROMPT_PREFIX}prompt-hash`,
    );
  });

  it("stabilizes tool cache keys across argument order", () => {
    const first = toolCacheKey("agent-1", "lookup", { a: 1, b: 2 });
    const second = toolCacheKey("agent-1", "lookup", { b: 2, a: 1 });

    expect(first).toBe(second);
    expect(first.startsWith(`${STORE_KEYS.TOOL_CACHE_PREFIX}agent-1:lookup:`)).toBe(
      true,
    );
    expect(first).not.toContain('"a":1');
  });
});