// examples/02-streaming.ts
// ─────────────────────────────────────────────────────────────────────────────
// Stream run events to stdout as they fire, using the onEvent callback.
// Prerequisites: ANTHROPIC_API_KEY in env.
// Run: npx tsx examples/02-streaming.ts
// ─────────────────────────────────────────────────────────────────────────────

import { createAgent, startRun } from "../src/index.js";
import type { RunEvent } from "../src/index.js";

const agent = createAgent({
  name: "streamer",
  systemPrompt: "You are a concise assistant.",
  model: "claude-sonnet-4-6",
});

function onEvent(event: RunEvent): void {
  switch (event.kind) {
    case "turn_start":
      console.log(`[turn ${event.turn}] started`);
      break;
    case "turn_end":
      console.log(`[turn ${event.turn}] ended — tokens used: ${event.usage.total ?? 0}`);
      break;
    case "tool_call":
      console.log(`[tool] calling ${event.toolCall.name}`);
      break;
    case "tool_result":
      console.log(`[tool] result (${event.durationMs}ms, error=${event.isError})`);
      break;
    case "complete":
      console.log("[complete]", event.result.status);
      break;
    case "error":
      console.error("[error]", event.message);
      break;
  }
}

const result = await startRun(
  agent,
  "List three famous landmarks in Paris, briefly.",
  { onEvent },
);

console.log("\nFinal response:\n", result.response);
