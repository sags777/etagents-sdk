/**
 * @module cli/commands/scan
 *
 * `eta scan <directory>` — Discover agent files and MCP configs.
 */

import type { Command } from "commander";
import { ToolScanner } from "../../scanner/index.js";

export function register(program: Command): void {
  program
    .command("scan <directory>")
    .description("Scan a directory for agent files (*.agent.ts / *.agent.js) and MCP configs (*.mcp.json).")
    .option("--agents", "Scan for agent files (default: true)")
    .option("--mcp", "Scan for *.mcp.json config files")
    .option("--json", "Machine-readable JSON output")
    .action(async (
      directory: string,
      opts: { agents?: boolean; mcp?: boolean; json?: boolean },
    ) => {
      const scanMcp = opts.mcp ?? false;
      const scanAgents = !scanMcp || (opts.agents ?? false);

      let result;
      try {
        result = ToolScanner.scan(directory, { agents: scanAgents, mcp: scanMcp });
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }

      if (opts.json) {
        console.log(JSON.stringify({
          agents: result.agents,
          mcp: result.mcpConfigs,
        }, null, 2));
        return;
      }

      if (scanAgents) {
        if (result.agents.length > 0) {
          console.log(`\nAgent files (${result.agents.length}):\n`);
          for (const a of result.agents) console.log(`  • ${a.file}`);
        } else {
          console.log("\nNo agent files found (*.agent.ts / *.agent.js).");
        }
      }

      if (scanMcp) {
        if (result.mcpConfigs.length > 0) {
          console.log(`\nMCP configs (${result.mcpConfigs.length}):\n`);
          for (const m of result.mcpConfigs) {
            const info = m.serverName ? ` — ${m.serverName} (${m.transport ?? "?"})` : "";
            console.log(`  • ${m.file}${info}`);
          }
        } else {
          console.log("\nNo MCP config files found (*.mcp.json).");
        }
      }

      console.log();
    });
}
