/**
 * @module @etagents/sdk/agent
 *
 * Public-facing agent definition API. Create agents, define tools, execute tools.
 */

export { defineTool, agentAsTool } from "./tool-builder.js";
export type { ToolConfig } from "../types/tool.js";
export { executeTool } from "./tool-executor.js";
export type { ToolContext, ToolExecResult } from "../types/tool.js";
export {
  createAgent,
  cloneAgent,
  Agent,
  agentToManifest,
} from "./agent-builder.js";
export type { AgentManifest } from "./agent-builder.js";
export type { AgentAsToolConfig } from "./tool-builder.js";
export { Tool } from "./tool-builder.js";
