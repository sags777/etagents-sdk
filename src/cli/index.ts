#!/usr/bin/env node

/**
 * eta — @etagents/sdk CLI
 *
 * Plugin-per-command architecture: each command lives in its own file
 * and registers itself via `register(program)`.
 */

import { Command } from "commander";
import { configureHelp } from "./help/help.js";
import { register as registerRun } from "./commands/run.js";
import { register as registerChat } from "./commands/chat.js";
import { register as registerExec } from "./commands/exec.js";
import { register as registerSession } from "./commands/session.js";
import { register as registerMemory } from "./commands/memory.js";
import { register as registerOrchestrate } from "./commands/orchestrate.js";
import { register as registerServe } from "./commands/serve.js";
import { register as registerBuild } from "./commands/build.js";
import { register as registerScan } from "./commands/scan.js";
import { register as registerInspect } from "./commands/inspect.js";
import { register as registerInit } from "./commands/init.js";
import { register as registerMask } from "./commands/mask.js";

const program = new Command("eta")
  .version("0.0.1")
  .description("@etagents/sdk CLI — build, run, and orchestrate AI agents")
  .addHelpText(
    "after",
    '\nRun "eta <command> --help" for command-specific help.\nAgent files must default-export an AgentDef created via createAgent().',
  );

// Apply custom help renderer
configureHelp(program.createHelp());

registerRun(program);
registerChat(program);
registerExec(program);
registerSession(program);
registerMemory(program);
registerOrchestrate(program);
registerServe(program);
registerBuild(program);
registerScan(program);
registerInspect(program);
registerInit(program);
registerMask(program);

program.parseAsync(process.argv).catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
