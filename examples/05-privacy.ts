// examples/05-privacy.ts
// ─────────────────────────────────────────────────────────────────────────────
// Attach RegexPrivacy so PII is masked before reaching the model and
// automatically restored in the response.
// Prerequisites: ANTHROPIC_API_KEY in env.
// Run: npx tsx examples/05-privacy.ts
// ─────────────────────────────────────────────────────────────────────────────

import { createAgent, startRun, RegexPrivacy } from "../src/index.js";

const privacy = new RegexPrivacy();

const agent = createAgent({
  name: "support-bot",
  systemPrompt:
    "You are a support agent. Acknowledge the user's request and confirm you will look into it.",
  model: "claude-sonnet-4-6",
  privacy,
});

// The input contains an email address and a phone number — both are PII.
const userMessage =
  "Hi, my name is Alice Johnson. Please reach me at alice@example.com or +1-555-867-5309.";

console.log("User input (raw):", userMessage);

const result = await startRun(agent, userMessage);

console.log("\nAgent response:", result.response);
// The response will reference the user's details without the model ever
// seeing the real values — the kernel masked them before the LLM call and
// unmasked placeholders in the reply.
