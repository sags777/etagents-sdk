import { RunSession } from "../run-session/run-session.js";
import type { AgentDef } from "../../types/domain/agent.js";
import type { RunConfig, RunResult } from "../../types/domain/run.js";

// ---------------------------------------------------------------------------
// startRun — public kernel entry point
// ---------------------------------------------------------------------------

/**
 * startRun — runs an agent to completion from a single user input.
 *
 * Thin wrapper over `RunSession.create(agent, config).run(input)`.
 * All orchestration logic lives in `RunSession`.
 */
export async function startRun(
  agent: AgentDef,
  input: string,
  config: RunConfig = {},
): Promise<RunResult> {
  const session = await RunSession.create(agent, config);
  return session.run(input);
}
