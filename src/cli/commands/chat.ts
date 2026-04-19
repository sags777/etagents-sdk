/**
 * @module cli/commands/chat
 *
 * `eta chat <agent-file>` — Interactive REPL with an agent.
 */

import * as readline from "node:readline/promises";
import { nanoid } from "nanoid";
import type { Command } from "commander";
import { loadAgentFile, withModel } from "../loader/loader.js";
import { startRun } from "../../kernel/run/run.js";
import type { RunConfig } from "../../types/run.js";

export function register(program: Command): void {
  program
    .command("chat <agent-file>")
    .description("Interactive REPL for chatting with an agent.")
    .option("--model <id>", "Override agent model (e.g. claude-sonnet-4-6)")
    .option("--api-key <key>", "API key (overrides env)")
    .option("--max-turns <n>", "Max LLM turns per message", Number)
    .option("--session-id <id>", "Run ID for session continuity")
    .option("--show-usage", "Print token usage per message")
    .action(async (
      agentFile: string,
      opts: {
        model?: string;
        apiKey?: string;
        maxTurns?: number;
        sessionId?: string;
        showUsage?: boolean;
      },
    ) => {
      let agent = await loadAgentFile(agentFile);
      if (opts.model) agent = withModel(agent, opts.model, opts.apiKey);

      const runId = opts.sessionId ?? `chat-${nanoid(8)}`;

      console.log(`\n${agent.name} — type your message (Ctrl+C or empty line to exit)\n`);

      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      try {
        while (true) {
          const input = await rl.question("You: ");
          if (!input.trim()) break;

          const config: RunConfig = {
            maxTurns: opts.maxTurns,
            runId,
          };

          let result;
          try {
            result = await startRun(agent, input, config);
          } catch (err) {
            console.error(`\nError: ${err instanceof Error ? err.message : String(err)}\n`);
            continue;
          }

          console.log(`\n${agent.name}: ${result.response}\n`);

          if (opts.showUsage && result.totalUsage) {
            process.stderr.write(
              `[usage] prompt=${result.totalUsage.prompt} completion=${result.totalUsage.completion} total=${result.totalUsage.total}\n`,
            );
          }
        }
      } catch {
        // Ctrl+C or EOF — exit cleanly
      } finally {
        rl.close();
      }

      console.log("\nGoodbye.");
    });
}
