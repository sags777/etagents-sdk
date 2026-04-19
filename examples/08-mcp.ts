// examples/08-mcp.ts
// ─────────────────────────────────────────────────────────────────────────────
// Connect an MCP server over stdio; the kernel auto-registers its tools.
// Prerequisites: ANTHROPIC_API_KEY in env, `npx` available.
// Run: npx tsx examples/08-mcp.ts
// ─────────────────────────────────────────────────────────────────────────────

import { createAgent, startRun } from "../src/index.js";
import type { McpServerConfig } from "../src/index.js";

// This example uses the official Filesystem MCP server as a demo.
// It exposes tools like read_file, write_file, list_directory, etc.
// The server is launched as a child process — no separate install needed.
const fsMcp: McpServerConfig = {
  serverName: "filesystem",
  transport: "stdio",
  command: "npx",
  args: [
    "-y",
    "@modelcontextprotocol/server-filesystem",
    // Restrict access to the current working directory
    process.cwd(),
  ],
};

const agent = createAgent({
  name: "file-assistant",
  systemPrompt:
    "You are an assistant with access to the local filesystem. Use the tools provided to answer questions about files.",
  model: "claude-sonnet-4-6",
  mcp: [fsMcp],
});

const result = await startRun(
  agent,
  "List the files in the current directory and briefly describe what you see.",
);

console.log("Response:", result.response);
console.log("Tool calls:", result.toolCalls.map((t) => t.name));
