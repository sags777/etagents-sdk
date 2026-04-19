/**
 * @module @etagents/sdk/agent
 *
 * Public-facing agent definition API. Create agents, define tools, execute tools.
 */

export { defineTool } from "./define-tool/define-tool.js";
export type { ToolConfig } from "./define-tool/define-tool.js";
export { executeTool } from "./executor/executor.js";
export type { ToolContext, ToolExecResult } from "./executor/executor.js";
export { createAgent } from "./create-agent/create-agent.js";
