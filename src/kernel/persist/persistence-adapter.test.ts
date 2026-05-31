import { describe, it, expect } from "vitest";
import type { StoreProvider } from "../../types/contracts/store.js";
import type { RunResult } from "../../types/domain/run.js";
import type { PendingApproval } from "../../types/domain/checkpoint.js";
import { PersistenceAdapter } from "./persistence-adapter.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMemoryStore(): StoreProvider {
  const map = new Map<string, unknown>();
  return {
    async read<T>(key: string): Promise<T | null> {
      return (map.get(key) ?? null) as T | null;
    },
    async write<T>(key: string, value: T): Promise<void> {
      map.set(key, value);
    },
    async remove(key: string): Promise<void> {
      map.delete(key);
    },
    async list(prefix: string): Promise<string[]> {
      return [...map.keys()].filter((k) => k.startsWith(prefix));
    },
  };
}

function makeRunResult(overrides: Partial<RunResult> = {}): RunResult {
  return {
    response: "done",
    messages: [],
    toolCalls: [],
    turns: 1,
    status: "complete",
    ...overrides,
  };
}

const NOW = new Date().toISOString();

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PersistenceAdapter", () => {
  describe("saveCompletedRun + run repository", () => {
    it("persists run telemetry, message turns, tool-call provenance, and events", async () => {
      const store = makeMemoryStore();
      const adapter = new PersistenceAdapter(store);

      await adapter.saveCompletedRun({
        runId: "run-001",
        agentId: "agent-001",
        agentModelProvider: "mock",
        agentModelId: "mock-model",
        result: makeRunResult({
          toolCalls: [
            {
              id: "tc-1",
              name: "echo",
              args: { msg: "hello" },
              result: "hello",
              durationMs: 12,
              agentName: "agent",
              turn: 1,
              isError: false,
              isFromCache: true,
            },
          ],
        }),
        messages: [
          { role: "user", content: "hello" },
          { role: "assistant", content: "hi" },
          { role: "tool", content: "hello", toolCallId: "tc-1" },
        ],
        metadata: {},
        createdAt: NOW,
        events: [
          {
            eventId: "ev-1",
            runId: "run-001",
            kind: "tool_result",
            turn: 1,
            payload: { toolCallId: "tc-1" },
            occurredAt: NOW,
          },
        ],
      });

      const run = await adapter.runs.load("run-001");
      expect(run).not.toBeNull();
      expect(run!.runId).toBe("run-001");
      expect(run!.agentId).toBe("agent-001");
      expect(run!.status).toBe("complete");
      expect(run!.modelProvider).toBe("mock");
      expect(run!.modelId).toBe("mock-model");

      const msgs = await adapter.messages.loadAll("run-001");
      expect(msgs).toHaveLength(3);
      expect(msgs[0].role).toBe("user");
      expect(msgs[1].role).toBe("assistant");
      expect(msgs[1].turn).toBe(1);
      expect(msgs[2].role).toBe("tool");
      expect(msgs[2].turn).toBe(1);

      const toolCalls = await adapter.toolCalls.loadAll("run-001");
      expect(toolCalls).toHaveLength(1);
      expect(toolCalls[0].turn).toBe(1);
      expect(toolCalls[0].isFromCache).toBe(true);

      const events = await adapter.runEvents.loadAll("run-001");
      expect(events).toHaveLength(1);
      expect(events[0].turn).toBe(1);
    });
  });

  describe("saveSuspendedRun + loadSuspendSnapshot round-trip", () => {
    it("saves and reloads a SuspendSnapshot", async () => {
      const store = makeMemoryStore();
      const adapter = new PersistenceAdapter(store);

      const pendingApprovals: PendingApproval[] = [
        {
          toolCallId: "tc-1",
          name: "shell",
          args: { cmd: "rm -rf /tmp/test" },
          agentName: "agent-001",
        },
      ];

      await adapter.saveSuspendedRun({
        runId: "run-002",
        agentId: "agent-001",
        checkpointId: "cp-002",
        pendingApprovals,
        messages: [
          { role: "user", content: "do it" },
          {
            role: "assistant",
            content: "ok",
            toolCalls: [
              { id: "tc-1", name: "shell", args: { cmd: "rm -rf /tmp/test" } },
            ],
          },
        ],
        metadata: {},
        suspendedAt: NOW,
        triggerToolName: "shell",
        createdAt: NOW,
        turns: 1,
        events: [],
      });

      const snapshot = await adapter.loadSuspendSnapshot("cp-002");
      expect(snapshot).not.toBeNull();

      const s = snapshot!;
      expect(s.suspendedAt).toBe(NOW);
      expect(s.triggerToolName).toBe("shell");
      expect(s.pendingApprovals).toHaveLength(1);
      expect(s.pendingApprovals[0].toolCallId).toBe("tc-1");
      expect(s.pendingApprovals[0].name).toBe("shell");

      // Messages round-trip
      expect(s.session.messages).toHaveLength(2);
      const assistantMsg = s.session.messages[1];
      expect(assistantMsg.role).toBe("assistant");
      expect(assistantMsg.toolCalls).toHaveLength(1);
      expect(assistantMsg.toolCalls![0].id).toBe("tc-1");
    });

    it("returns null for unknown checkpointId", async () => {
      const store = makeMemoryStore();
      const adapter = new PersistenceAdapter(store);

      const result = await adapter.loadSuspendSnapshot("nonexistent");
      expect(result).toBeNull();
    });
  });

  describe("removeSuspendedRun", () => {
    it("removes checkpoint only — keeps approvals for audit, leaves run+messages", async () => {
      const store = makeMemoryStore();
      const adapter = new PersistenceAdapter(store);

      await adapter.saveSuspendedRun({
        runId: "run-003",
        agentId: "agent-001",
        checkpointId: "cp-003",
        pendingApprovals: [
          {
            toolCallId: "tc-x",
            name: "tool",
            args: {},
            agentName: "agent-001",
          },
        ],
        messages: [{ role: "user", content: "test" }],
        metadata: {},
        suspendedAt: NOW,
        createdAt: NOW,
        turns: 1,
        events: [],
      });

      // Verify present before remove
      expect(await adapter.loadSuspendSnapshot("cp-003")).not.toBeNull();

      await adapter.removeSuspendedRun("cp-003");

      // Checkpoint gone — loadSuspendSnapshot returns null
      expect(await adapter.loadSuspendSnapshot("cp-003")).toBeNull();

      // Run record still available for audit
      const run = await adapter.runs.load("run-003");
      expect(run).not.toBeNull();

      // Approval records are KEPT for audit trail
      const approvals = await adapter.approvals.loadAll("cp-003");
      expect(approvals).toHaveLength(1);
      expect(approvals[0].toolCallId).toBe("tc-x");
    });
  });

  describe("resolveApprovals", () => {
    it("updates approval records to approved/rejected with decidedBy and decidedAt", async () => {
      const store = makeMemoryStore();
      const adapter = new PersistenceAdapter(store);
      const decidedAt = new Date().toISOString();

      await adapter.saveSuspendedRun({
        runId: "run-ra",
        agentId: "agent-001",
        checkpointId: "cp-ra",
        pendingApprovals: [
          {
            toolCallId: "tc-1",
            name: "shell",
            args: {},
            agentName: "agent-001",
          },
          {
            toolCallId: "tc-2",
            name: "write",
            args: {},
            agentName: "agent-001",
          },
        ],
        messages: [],
        metadata: {},
        suspendedAt: NOW,
        createdAt: NOW,
        turns: 1,
        events: [],
      });

      await adapter.resolveApprovals(
        "cp-ra",
        [
          { toolCallId: "tc-1", approved: true },
          { toolCallId: "tc-2", approved: false },
        ],
        "system",
        decidedAt,
      );

      const records = await adapter.approvals.loadAll("cp-ra");
      expect(records).toHaveLength(2);

      const approved = records.find((r) => r.toolCallId === "tc-1")!;
      expect(approved.decision).toBe("approved");
      expect(approved.decidedBy).toBe("system");
      expect(approved.decidedAt).toBe(decidedAt);

      const rejected = records.find((r) => r.toolCallId === "tc-2")!;
      expect(rejected.decision).toBe("rejected");
      expect(rejected.decidedBy).toBe("system");
    });

    it("is a no-op when checkpointId has no approvals", async () => {
      const store = makeMemoryStore();
      const adapter = new PersistenceAdapter(store);

      // Should not throw
      await expect(
        adapter.resolveApprovals(
          "nonexistent",
          [{ toolCallId: "tc-1", approved: true }],
          "system",
          NOW,
        ),
      ).resolves.toBeUndefined();
    });
  });

  describe("incrementResumeAttempts", () => {
    it("increments resumeAttempts on a checkpoint record", async () => {
      const store = makeMemoryStore();
      const adapter = new PersistenceAdapter(store);

      await adapter.saveSuspendedRun({
        runId: "run-ira",
        agentId: "agent-001",
        checkpointId: "cp-ira",
        pendingApprovals: [],
        messages: [],
        metadata: {},
        suspendedAt: NOW,
        createdAt: NOW,
        turns: 0,
        events: [],
      });

      const before = await adapter.checkpoints.load("cp-ira");
      expect(before!.resumeAttempts).toBe(0);

      await adapter.incrementResumeAttempts("cp-ira");

      const after = await adapter.checkpoints.load("cp-ira");
      expect(after!.resumeAttempts).toBe(1);
    });

    it("sets resolvedAt when provided", async () => {
      const store = makeMemoryStore();
      const adapter = new PersistenceAdapter(store);
      const resolvedAt = new Date().toISOString();

      await adapter.saveSuspendedRun({
        runId: "run-ira2",
        agentId: "agent-001",
        checkpointId: "cp-ira2",
        pendingApprovals: [],
        messages: [],
        metadata: {},
        suspendedAt: NOW,
        createdAt: NOW,
        turns: 0,
        events: [],
      });

      await adapter.incrementResumeAttempts("cp-ira2", resolvedAt);

      const record = await adapter.checkpoints.load("cp-ira2");
      expect(record!.resolvedAt).toBe(resolvedAt);
      expect(record!.resumeAttempts).toBe(1);
    });

    it("is a no-op for nonexistent checkpoint", async () => {
      const store = makeMemoryStore();
      const adapter = new PersistenceAdapter(store);

      await expect(
        adapter.incrementResumeAttempts("ghost-cp"),
      ).resolves.toBeUndefined();
    });
  });

  describe("message encoding/decoding — assistant with toolCalls", () => {
    it("preserves toolCalls in assistant messages through save/load cycle", async () => {
      const store = makeMemoryStore();
      const adapter = new PersistenceAdapter(store);

      const toolCalls = [
        { id: "tc-a", name: "search", args: { query: "etagents" } },
        { id: "tc-b", name: "write", args: { file: "out.txt", text: "hello" } },
      ];

      await adapter.saveSuspendedRun({
        runId: "run-004",
        agentId: "agent-001",
        checkpointId: "cp-004",
        pendingApprovals: [
          {
            toolCallId: "tc-a",
            name: "search",
            args: { query: "etagents" },
            agentName: "agent-001",
          },
        ],
        messages: [
          { role: "user", content: "do two things" },
          { role: "assistant", content: "sure", toolCalls },
        ],
        metadata: {},
        suspendedAt: NOW,
        createdAt: NOW,
        turns: 1,
        events: [],
      });

      const snapshot = await adapter.loadSuspendSnapshot("cp-004");
      expect(snapshot).not.toBeNull();

      const msgs = snapshot!.session.messages;
      const assistant = msgs.find((m) => m.role === "assistant");
      expect(assistant).toBeDefined();
      expect(assistant!.toolCalls).toHaveLength(2);
      expect(assistant!.toolCalls![0].id).toBe("tc-a");
      expect(assistant!.toolCalls![1].name).toBe("write");
    });
  });
});
