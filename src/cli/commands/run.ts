/**
 * @module cli/commands/run
 *
 * `eta run <agent-file> <prompt>` — Single-shot LLM run.
 */

import type { Command } from "commander";
import { loadAgentFile, withModel } from "../loader/loader.js";
import { startRun } from "../../kernel/run/run.js";
import type { RunConfig, RunEvent } from "../../types/run.js";

export function register(program: Command): void {
  program
    .command("run <agent-file> <prompt>")
    .description("Run an agent against a prompt and print the response.")
    .option("--model <id>", "Override agent model (e.g. claude-sonnet-4-6)")
    .option("--api-key <key>", "API key (overrides env)")
    .option("--max-turns <n>", "Max LLM turns", Number)
    .option("--session-id <id>", "Run ID for session continuity")
    .option("--show-usage", "Print token usage to stderr")
    .option("--show-turns", "Print turn count to stderr")
    .option("--show-tool-calls", "Print tool call summary to stderr")
    .option("--events", "Print run events to stderr")
    .option("--json", "Structured JSON output")
    .action(async (
      agentFile: string,
      prompt: string,
      opts: {
        model?: string;
        apiKey?: string;
        maxTurns?: number;
        sessionId?: string;
        showUsage?: boolean;
        showTurns?: boolean;
        showToolCalls?: boolean;
        events?: boolean;
        json?: boolean;
      },
    ) => {
      let agent = await loadAgentFile(agentFile);
      if (opts.model) agent = withModel(agent, opts.model, opts.apiKey);

      const config: RunConfig = {
        maxTurns: opts.maxTurns,
        runId: opts.sessionId,
        onEvent: opts.events ? printEvent : undefined,
      };

      const result = await startRun(agent, prompt, config);

      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      console.log(result.response);

      if (opts.showUsage && result.totalUsage) {
        process.stderr.write(
          `[usage] prompt=${result.totalUsage.prompt} completion=${result.totalUsage.completion} total=${result.totalUsage.total}\n`,
        );
      }
      if (opts.showTurns) process.stderr.write(`[turns] ${result.turns}\n`);
      if (opts.showToolCalls && result.toolCalls.length > 0) {
        process.stderr.write(
          `[tool-calls] ${result.toolCalls.map((tc) => tc.name).join(", ")}\n`,
        );
      }
    });
}

function printEvent(event: RunEvent): void {
  switch (event.kind) {
    case "turn_start":
      process.stderr.write(`[turn ${event.turn}] start\n`);
      break;
    case "tool_call":
      process.stderr.write(`→ ${event.toolCall.name}(${JSON.stringify(event.toolCall.args)})\n`);
      break;
    case "tool_result":
      process.stderr.write(
        `← ${event.toolCallId} (${event.durationMs}ms)${event.isError ? " ERROR" : ""}\n`,
      );
      break;
    case "error":
      process.stderr.write(`✗ [${event.code}] ${event.message}\n`);
      break;
  }
}
