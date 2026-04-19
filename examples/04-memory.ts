// examples/04-memory.ts
// ─────────────────────────────────────────────────────────────────────────────
// Use the InMemory provider to seed facts that get injected into context.
// Prerequisites: ANTHROPIC_API_KEY in env.
// Run: npx tsx examples/04-memory.ts
// ─────────────────────────────────────────────────────────────────────────────

import { createAgent, startRun, InMemory } from "../src/index.js";

const memory = new InMemory();

// Pre-seed memory with facts the agent should recall
const scope = { agentId: "concierge", namespace: "user-prefs" };
await memory.index({ id: "pref-1", text: "The user prefers vegetarian food.", scope });
await memory.index({ id: "pref-2", text: "The user is based in Amsterdam.", scope });
await memory.index({ id: "pref-3", text: "The user speaks English and Dutch.", scope });

const agent = createAgent({
  name: "concierge",
  systemPrompt: "You are a personal concierge. Use the context provided to personalise responses.",
  model: "claude-sonnet-4-6",
  memory,
});

// Ask something that benefits from the seeded preferences
const result = await startRun(
  agent,
  "Can you recommend a restaurant for tonight?",
);

console.log("Response:", result.response);
