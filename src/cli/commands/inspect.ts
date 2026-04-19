/**
 * @module cli/commands/inspect
 *
 * `eta inspect <agent-file>` — Print agent structure and session state.
 */

import type { Command } from "commander";
import { loadAgentFile } from "../loader/loader.js";

export function register(program: Command): void {
  program
    .command("inspect <agent-file>")
    .description("Inspect an agent file and display its structure.")
    .option("--session-id <id>", "Also load and display a session snapshot")
    .option("--store <spec>", "Store spec for session lookup: file:<dir> or redis:<url>", "file:.sessions")
    .option("--json", "Machine-readable JSON output")
    .action(async (
      agentFile: string,
      opts: { sessionId?: string; store?: string; json?: boolean },
    ) => {
      const agent = await loadAgentFile(agentFile);

      if (opts.json) {
        const out = {
          name: agent.name,
          systemPrompt: agent.systemPrompt,
          maxTurns: agent.maxTurns,
          maxTokens: agent.maxTokens,
          tools: agent.tools.map((t) => ({
            name: t.name,
            description: t.description,
            schema: t.schema,
            sensitive: t.sensitive,
          })),
          mcp: agent.mcp,
          session: null as unknown,
        };

        if (opts.sessionId) {
          out.session = await loadSession(opts.store ?? "file:.sessions", opts.sessionId);
        }

        console.log(JSON.stringify(out, null, 2));
        return;
      }

      console.log(`\nAgent: ${agent.name}`);
      console.log(`  Max turns:  ${agent.maxTurns}`);
      console.log(`  Max tokens: ${agent.maxTokens}`);

      const prompt = agent.systemPrompt.length > 120
        ? agent.systemPrompt.slice(0, 120) + "…"
        : agent.systemPrompt;
      console.log(`  System: "${prompt}"`);

      if (agent.tools.length > 0) {
        console.log(`\n  Tools (${agent.tools.length}):`);
        for (const t of agent.tools) {
          const flags: string[] = [];
          if (t.sensitive) flags.push("sensitive");
          const flagStr = flags.length > 0 ? ` [${flags.join(", ")}]` : "";
          console.log(`    • ${t.name}: ${t.description}${flagStr}`);
        }
      }

      if (agent.mcp && agent.mcp.length > 0) {
        console.log(`\n  MCP servers (${agent.mcp.length}):`);
        for (const m of agent.mcp) {
          const transport = "transport" in m ? (m as { transport: string }).transport : "stdio";
          console.log(`    • ${m.serverName} (${transport})`);
        }
      }

      if (opts.sessionId) {
        const snap = await loadSession(opts.store ?? "file:.sessions", opts.sessionId);
        if (!snap) {
          console.log(`\n  Session "${opts.sessionId}": not found`);
        } else {
          const s = snap as { runId?: string; updatedAt?: string; messages?: unknown[] };
          console.log(`\n  Session: ${s.runId}`);
          console.log(`    Updated:  ${s.updatedAt}`);
          console.log(`    Messages: ${s.messages?.length ?? 0}`);
        }
      }

      console.log();
    });
}

async function loadSession(spec: string, sessionId: string): Promise<unknown> {
  const SESSION_PREFIX = "eta:run:";
  const { FileStore } = await import("../../providers/store/index.js");

  if (spec.startsWith("redis:")) {
    const { RedisStore } = await import("../../providers/store/index.js");
    const rs = await RedisStore.connect({ url: spec.slice("redis:".length), namespace: "cli" });
    const snap = await rs.read(`${SESSION_PREFIX}${sessionId}`);
    await rs.quit();
    return snap;
  }

  const dir = spec.startsWith("file:") ? spec.slice("file:".length) : spec;
  const store = new FileStore(dir || ".sessions");
  return store.read(`${SESSION_PREFIX}${sessionId}`);
}
