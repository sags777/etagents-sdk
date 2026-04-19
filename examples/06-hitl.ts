// examples/06-hitl.ts
// ─────────────────────────────────────────────────────────────────────────────
// Suspend a run before every tool call and resume with human approval.
// Prerequisites: ANTHROPIC_API_KEY in env.
// Run: npx tsx examples/06-hitl.ts
// ─────────────────────────────────────────────────────────────────────────────

import { z } from "zod";
import { createAgent, startRun, continueRun, defineTool, FileStore } from "../src/index.js";
import type { RunEvent } from "../src/index.js";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ── Shared store for HITL checkpoints ────────────────────────────────────────

const storeDir = await mkdtemp(join(tmpdir(), "eta-hitl-"));
const hitlStore = new FileStore(storeDir);

// ── Tool that requires human approval ────────────────────────────────────────

const sendEmailTool = defineTool({
  name: "send_email",
  description: "Send an email to a recipient.",
  params: z.object({
    to: z.string().describe("Recipient email address"),
    subject: z.string(),
    body: z.string(),
  }),
  async handler({ to, subject }) {
    // In a real app this would call an email API.
    console.log(`  [EMAIL SENT] to=${to} subject="${subject}"`);
    return "Email sent successfully.";
  },
});

// ── Agent with HITL mode ──────────────────────────────────────────────────────

const agent = createAgent({
  name: "email-agent",
  systemPrompt: "You are an assistant that drafts and sends emails on behalf of the user.",
  model: "claude-sonnet-4-6",
  tools: [sendEmailTool],
  hitl: { mode: "tool", hitlStore },
});

// ── Step 1: start a run — it will suspend awaiting approval ─────────────────

let checkpointId: string | undefined;

const firstResult = await startRun(
  agent,
  "Send a brief welcome email to new@example.com with subject 'Welcome aboard!'",
  {
    onEvent(event: RunEvent) {
      if (event.kind === "complete" && event.result.status === "awaiting_approval") {
        // The run suspended — a checkpoint was persisted to hitlStore.
        // In a real app you would read the checkpoint ID from the store or
        // pass it via metadata; here we grab it from a side-channel.
        console.log("Run suspended — awaiting human approval.");
      }
    },
  },
);

if (firstResult.status !== "awaiting_approval") {
  console.log("Run completed without needing approval:", firstResult.response);
  process.exit(0);
}

// Retrieve the checkpoint ID from the store
const keys = await hitlStore.list("suspend:");
checkpointId = keys[0];

if (!checkpointId) {
  console.error("No checkpoint found in store.");
  process.exit(1);
}

// Remove the "suspend:" prefix that FileStore uses as a key
const rawKey = checkpointId.replace(/^suspend:/, "");
const snapshot = await hitlStore.read<{ pendingApprovals: Array<{ toolCallId: string; name: string; args: unknown }> }>(rawKey);

if (!snapshot) {
  console.error("Could not load checkpoint snapshot.");
  process.exit(1);
}

console.log("\nPending tool calls requiring approval:");
for (const pa of snapshot.pendingApprovals) {
  console.log(`  • ${pa.name} — args: ${JSON.stringify(pa.args)}`);
}

// ── Step 2: simulate a human approving all pending tool calls ────────────────

console.log("\nHuman approved all tool calls. Resuming...\n");

const decisions = snapshot.pendingApprovals.map((pa) => ({
  toolCallId: pa.toolCallId,
  approved: true,
}));

const finalResult = await continueRun(rawKey, decisions, { agent });

console.log("Final response:", finalResult.response);
console.log("Status:", finalResult.status);
