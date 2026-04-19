/**
 * @module cli/commands/scan
 *
 * `eta scan <directory>` — Discover agent files and MCP configs.
 */

import fs from "node:fs";
import path from "node:path";
import type { Command } from "commander";

interface ScannedAgent {
  file: string;
  name?: string;
}

interface ScannedMcp {
  file: string;
  serverName?: string;
  transport?: string;
}

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
      const resolved = path.resolve(directory);

      if (!fs.existsSync(resolved)) {
        console.error(`Error: Directory "${directory}" does not exist.`);
        process.exit(1);
      }

      const scanMcp = opts.mcp ?? false;
      const showAgents = !scanMcp || (opts.agents ?? false);

      const agentFiles: ScannedAgent[] = [];
      const mcpFiles: ScannedMcp[] = [];

      walkDir(resolved, (file) => {
        const rel = path.relative(resolved, file);

        if (showAgents && (file.endsWith(".agent.ts") || file.endsWith(".agent.js"))) {
          agentFiles.push({ file: rel });
        }

        if (scanMcp && file.endsWith(".mcp.json")) {
          try {
            const raw = JSON.parse(fs.readFileSync(file, "utf-8")) as {
              serverName?: string;
              transport?: string;
            };
            mcpFiles.push({ file: rel, serverName: raw.serverName, transport: raw.transport });
          } catch {
            mcpFiles.push({ file: rel });
          }
        }
      });

      if (opts.json) {
        console.log(JSON.stringify({ agents: agentFiles, mcp: mcpFiles }, null, 2));
        return;
      }

      if (showAgents) {
        if (agentFiles.length > 0) {
          console.log(`\nAgent files (${agentFiles.length}):\n`);
          for (const a of agentFiles) console.log(`  • ${a.file}`);
        } else {
          console.log("\nNo agent files found (*.agent.ts / *.agent.js).");
        }
      }

      if (scanMcp) {
        if (mcpFiles.length > 0) {
          console.log(`\nMCP configs (${mcpFiles.length}):\n`);
          for (const m of mcpFiles) {
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

function walkDir(dir: string, cb: (file: string) => void): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== "node_modules" && !entry.name.startsWith(".")) {
      walkDir(full, cb);
    } else if (entry.isFile()) {
      cb(full);
    }
  }
}
