/**
 * @module cli/commands/exec
 *
 * `eta exec <agent-file> <tool-name>` — Execute one tool directly (no LLM).
 */

import type { Command } from "commander";
import { loadAgentFile } from "../loader/loader.js";
import { executeTool } from "../../agent/executor/executor.js";

export function register(program: Command): void {
  program
    .command("exec <agent-file> <tool-name>")
    .description("Execute a single tool from an agent file, bypassing the LLM.")
    .option("--args <json>", "JSON string of tool arguments", "{}")
    .option("--list", "List available tools without executing")
    .option("--json", "Structured JSON output")
    .action(async (
      agentFile: string,
      toolName: string,
      opts: { args?: string; list?: boolean; json?: boolean },
    ) => {
      const agent = await loadAgentFile(agentFile);

      if (opts.list) {
        if (opts.json) {
          console.log(JSON.stringify(agent.tools.map((t) => ({ name: t.name, description: t.description })), null, 2));
        } else {
          console.log(`\nTools in "${agent.name}":\n`);
          for (const t of agent.tools) {
            console.log(`  • ${t.name}: ${t.description}`);
          }
          console.log();
        }
        return;
      }

      const tool = agent.tools.find((t) => t.name === toolName);
      if (!tool) {
        const names = agent.tools.map((t) => t.name).join(", ");
        console.error(`Error: Tool "${toolName}" not found. Available: ${names || "(none)"}`);
        process.exit(1);
      }

      let parsedArgs: unknown;
      try {
        parsedArgs = JSON.parse(opts.args ?? "{}");
      } catch {
        console.error(`Error: Invalid JSON in --args: ${opts.args}`);
        process.exit(1);
      }

      const result = await executeTool(tool, parsedArgs, { runId: "cli", agentName: agent.name, messages: [] });
      console.log(JSON.stringify(result, null, 2));
    });
}
