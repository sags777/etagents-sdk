// examples/04-memory.ts
// ─────────────────────────────────────────────────────────────────────────────
// Use the InMemory provider to seed facts that get injected into context.
// Prerequisites: ANTHROPIC_API_KEY in env.
// Run: npx tsx examples/04-memory.ts
// ─────────────────────────────────────────────────────────────────────────────

import { createAgent, startRun, InMemory } from "../src/index.js";

const memory = new InMemory();

const agent = createAgent({
  name: "concierge",
  systemPrompt: "You are a personal concierge. Use the context provided to personalise responses.",
  model: "claude-sonnet-4-6",
  memory,
  memoryRetrieval: {
    minScore: 0.7,
    topK: { user_fact: 3, fact: 1 },
    budget: 220,
  },
});

// Pre-seed memory using the same scope RunSession will query.
const scope = { agentId: agent.agentId, namespace: "default" };
await memory.index({
  id: "pref-1",
  text: "The user prefers vegetarian food.",
  kind: "user_fact",
  scope,
});
await memory.index({
  id: "pref-2",
  text: "The user is based in Amsterdam.",
  kind: "user_fact",
  scope,
});
await memory.index({
  id: "pref-3",
  text: "The user speaks English and Dutch.",
  kind: "user_fact",
  scope,
});
await memory.index({
  id: "pref-4",
  text: "The user likes canal-side restaurants with outdoor seating.",
  kind: "fact",
  scope,
});

// Ask something that benefits from the seeded preferences
const result = await startRun(
  agent,
  "Can you recommend a restaurant for tonight?",
);

console.log("Response:", result.response);
