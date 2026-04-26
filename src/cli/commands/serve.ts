/**
 * @module cli/commands/serve
 *
 * `eta serve <agent-file>` — Expose an agent's tools as an MCP server.
 */

import type { Command } from "commander";
import { loadAgentFile } from "../loader/loader.js";
import { McpServer } from "../../mcp/index.js";

export function register(program: Command): void {
  program
    .command("serve <agent-file>")
    .description("Start an agent's tools as an MCP server (stdio by default).")
    .option("--name <name>", "MCP server name override")
    .option("--version <ver>", "MCP server version override", "1.0.0")
    .action(async (
      agentFile: string,
      opts: { name?: string; version?: string },
    ) => {
      const agent = await loadAgentFile(agentFile);
      const serverName = opts.name ?? agent.name;
      const version = opts.version ?? agent.version ?? "1.0.0";

      const server = new McpServer({ name: serverName, version });

      for (const tool of agent.tools) {
        server.addTool(tool);
      }

      process.stderr.write(`Starting MCP server "${serverName}" v${version} via stdio...\n`);
      await server.start();
    });
}
