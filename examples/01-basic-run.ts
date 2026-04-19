// examples/01-basic-run.ts
// ─────────────────────────────────────────────────────────────────────────────
// Minimal example: create an agent, run it once, print the result.
// Prerequisites: ANTHROPIC_API_KEY in env.
// Run: npx tsx examples/01-basic-run.ts
// ─────────────────────────────────────────────────────────────────────────────

import { createAgent, startRun } from "../src/index.js";

const agent = createAgent({
  name: "assistant",
  systemPrompt: "You are a concise, helpful assistant.",
  model: "claude-sonnet-4-6",
});

const result = await startRun(agent, "What is the capital of France?");

console.log("Response:", result.response);
console.log("Status:", result.status);
console.log("Turns:", result.turns);
