// examples/03-tools.ts
// ─────────────────────────────────────────────────────────────────────────────
// Define typed tools with Zod schemas and wire them into an agent run.
// Prerequisites: ANTHROPIC_API_KEY in env.
// Run: npx tsx examples/03-tools.ts
// ─────────────────────────────────────────────────────────────────────────────

import { z } from "zod";
import { createAgent, defineTool, startRun } from "../src/index.js";

// ── Tool: weather lookup (simulated) ────────────────────────────────────────

const weatherTool = defineTool({
  name: "get_weather",
  description: "Return the current weather for a given city.",
  params: z.object({
    city: z.string().describe("The city name, e.g. 'London'"),
  }),
  async handler({ city }) {
    // In a real app this would call a weather API.
    const conditions = ["sunny", "cloudy", "rainy", "windy"];
    const condition = conditions[city.length % conditions.length];
    return JSON.stringify({ city, condition, tempC: 15 + (city.length % 10) });
  },
});

// ── Tool: unit conversion ────────────────────────────────────────────────────

const convertTool = defineTool({
  name: "convert_temperature",
  description: "Convert a temperature from Celsius to Fahrenheit.",
  params: z.object({
    celsius: z.number().describe("Temperature in degrees Celsius"),
  }),
  async handler({ celsius }) {
    return String((celsius * 9) / 5 + 32);
  },
});

// ── Agent ────────────────────────────────────────────────────────────────────

const agent = createAgent({
  name: "weather-bot",
  systemPrompt:
    "You are a helpful weather assistant. Use available tools to answer questions.",
  model: "claude-sonnet-4-6",
  tools: [weatherTool, convertTool],
});

const result = await startRun(
  agent,
  "What's the weather in Tokyo? Also convert the temperature to Fahrenheit.",
);

console.log("Response:", result.response);
console.log("Tool calls:", result.toolCalls.map((t) => t.name));
