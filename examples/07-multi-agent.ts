// examples/07-multi-agent.ts
// ─────────────────────────────────────────────────────────────────────────────
// Route messages to specialist agents using AgentRouter + RuleRouter.
// Prerequisites: ANTHROPIC_API_KEY in env.
// Run: npx tsx examples/07-multi-agent.ts
// ─────────────────────────────────────────────────────────────────────────────

import { createAgent, AgentRouter, RuleRouter } from "../src/index.js";

// ── Specialist agents ────────────────────────────────────────────────────────

const billingAgent = createAgent({
  name: "billing",
  systemPrompt:
    "You are a billing specialist. Answer questions about invoices, payments, and subscriptions concisely.",
  model: "claude-sonnet-4-6",
});

const supportAgent = createAgent({
  name: "support",
  systemPrompt:
    "You are a technical support specialist. Help users troubleshoot bugs and errors concisely.",
  model: "claude-sonnet-4-6",
});

const generalAgent = createAgent({
  name: "general",
  systemPrompt: "You are a helpful general assistant. Answer concisely.",
  model: "claude-sonnet-4-6",
});

// ── Router with deterministic rules ──────────────────────────────────────────

const strategy = new RuleRouter()
  .when(/\b(invoice|billing|payment|subscription|charge)\b/i, billingAgent)
  .when(/\b(bug|error|crash|broken|not working|exception)\b/i, supportAgent)
  .fallback(generalAgent)
  .build();

const router = AgentRouter.create()
  .add(billingAgent)
  .add(supportAgent)
  .add(generalAgent)
  .withStrategy(strategy)
  .build();

// ── Route three different messages ───────────────────────────────────────────

const messages = [
  "I was charged twice on my last invoice.",
  "The app crashes every time I click the export button.",
  "What is the Pythagorean theorem?",
];

for (const message of messages) {
  console.log(`\nUser: ${message}`);
  const result = await router.run(message);
  console.log(`Agent: ${result.response.slice(0, 120)}...`);
}
