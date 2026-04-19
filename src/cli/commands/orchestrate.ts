/**
 * @module cli/commands/orchestrate
 *
 * `eta orchestrate <prompt>` — Multi-agent run with routing.
 */

import type { Command } from "commander";
import { loadAgentFile, resolveModel } from "../loader/loader.js";
import { AgentRouter } from "../../orchestration/index.js";
import { TriageRouter } from "../../orchestration/index.js";
import type { RunConfig } from "../../types/run.js";

export function register(program: Command): void {
  program
    .command("orchestrate <prompt>")
    .description("Route a prompt to the best agent from a pool.")
    .requiredOption(
      "--agents <paths>",
      "Comma-separated agent file paths",
      (v: string) => v.split(",").map((s) => s.trim()),
    )
    .option("--router <type>", "Routing strategy: triage (default) or rule", "triage")
    .option("--triage-model <id>", "Model for triage routing (default: agent's model)")
    .option("--triage-api-key <key>", "API key for triage model")
    .option("--max-turns <n>", "Max LLM turns", Number)
    .option("--session-id <id>", "Run ID")
    .option("--show-usage", "Print token usage")
    .option("--json", "Structured JSON output")
    .action(async (
      prompt: string,
      opts: {
        agents: string[];
        router?: string;
        triageModel?: string;
        triageApiKey?: string;
        maxTurns?: number;
        sessionId?: string;
        showUsage?: boolean;
        json?: boolean;
      },
    ) => {
      const agents = [];
      for (const agentPath of opts.agents) {
        try {
          agents.push(await loadAgentFile(agentPath));
        } catch (err) {
          console.error(`Error loading "${agentPath}": ${err instanceof Error ? err.message : String(err)}`);
          process.exit(1);
        }
      }

      if (agents.length === 0) {
        console.error("Error: At least one agent is required via --agents.");
        process.exit(1);
      }

      console.error(`Loaded ${agents.length} agents: ${agents.map((a) => a.name).join(", ")}`);

      // Build routing strategy
      let strategy: TriageRouter;
      if (opts.router === "triage" || !opts.router) {
        // Use the first agent's model for triage, or an explicit triage model
        const triageModel = opts.triageModel
          ? resolveModel(opts.triageModel, opts.triageApiKey)
          : agents[0].model;
        strategy = new TriageRouter({ model: triageModel, agents });
      } else {
        console.error(`Unknown router type: "${opts.router}". Valid: triage`);
        process.exit(1);
      }

      const router = AgentRouter.create()
        .withStrategy(strategy);

      for (const agent of agents) {
        router.add(agent);
      }

      const config: RunConfig = {
        maxTurns: opts.maxTurns,
        runId: opts.sessionId,
      };

      const result = await router.build().run(prompt, config);

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
    });
}
