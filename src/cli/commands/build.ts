/**
 * @module cli/commands/build
 *
 * `eta build <agent-file>` — Type-check and validate an agent file.
 */

import path from "node:path";
import fs from "node:fs";
import type { Command } from "commander";
import { loadAgentFile } from "../loader/loader.js";

export function register(program: Command): void {
  program
    .command("build <agent-file>")
    .description("Type-check and validate an agent file, or write its manifest to disk.")
    .option("--out <path>", "Write manifest JSON to file instead of stdout")
    .option("--typecheck-only", "Validate the file without generating manifest output")
    .action(async (
      agentFile: string,
      opts: { out?: string; typecheckOnly?: boolean },
    ) => {
      const agent = await loadAgentFile(agentFile);
      console.error(`✓ Agent "${agent.name}" loaded successfully.`);

      if (opts.typecheckOnly) {
        console.error(`✓ Validation passed for ${agentFile}`);
        return;
      }

      const manifest = {
        name: agent.name,
        systemPrompt: agent.systemPrompt,
        maxTurns: agent.maxTurns,
        maxTokens: agent.maxTokens,
        tools: agent.tools.map((t) => ({
          name: t.name,
          description: t.description,
          schema: t.schema,
        })),
        mcp: agent.mcp,
      };

      const json = JSON.stringify(manifest, null, 2);

      if (opts.out) {
        const resolved = path.resolve(opts.out);
        fs.writeFileSync(resolved, json, "utf-8");
        console.error(`✓ Manifest written to ${resolved}`);
      } else {
        console.log(json);
      }
    });
}
