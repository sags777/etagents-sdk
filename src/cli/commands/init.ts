/**
 * @module cli/commands/init
 *
 * `eta init <agent-name>` — Scaffold a new agent file.
 */

import fs from "node:fs";
import path from "node:path";
import type { Command } from "commander";

export function register(program: Command): void {
  program
    .command("init <agent-name>")
    .description("Scaffold a new agent file in the current directory.")
    .option("--with-tools", "Include example tool scaffolds")
    .option("--with-mcp", "Include MCP client setup boilerplate")
    .action((
      agentName: string,
      opts: { withTools?: boolean; withMcp?: boolean },
    ) => {
      const fileName = `${agentName}.agent.ts`;
      const filePath = path.resolve(fileName);

      if (fs.existsSync(filePath)) {
        console.error(`Error: File "${fileName}" already exists.`);
        process.exit(1);
      }

      const content = generateTemplate(agentName, opts.withTools ?? false, opts.withMcp ?? false);
      fs.writeFileSync(filePath, content, "utf-8");
      console.log(`✓ Created ${fileName}`);
    });
}

function camelCase(str: string): string {
  return str
    .replace(/[^a-zA-Z0-9]+(.)/g, (_, ch: string) => (ch as string).toUpperCase())
    .replace(/^[A-Z]/, (ch) => ch.toLowerCase());
}

function generateTemplate(name: string, withTools: boolean, withMcp: boolean): string {
  const toolImport = withTools ? ", defineTool" : "";
  const zodImport = withTools ? '\nimport { z } from "zod";' : "";
  const mcpImport = withMcp ? '\nimport type { McpServerConfig } from "@etagents/sdk";' : "";

  const toolDefs = withTools ? `
// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

const greet = defineTool({
  name: "greet",
  description: "Greet a user by name.",
  params: z.object({
    name: z.string().describe("The name to greet"),
  }),
  handler: async ({ name }) => {
    return \`Hello, \${name}! Powered by @etagents/sdk.\`;
  },
});

` : "";

  const mcpDefs = withMcp ? `
// ---------------------------------------------------------------------------
// MCP servers (uncomment and configure)
// ---------------------------------------------------------------------------

// const myMcp: McpServerConfig = {
//   serverName: "my-server",
//   transport: "stdio",
//   command: "npx",
//   args: ["@modelcontextprotocol/server-everything"],
// };

` : "";

  const toolsList = withTools ? "[greet]" : "[]";
  const mcpList = withMcp ? "  // mcp: [myMcp]," : "";

  const varName = camelCase(name);

  return `import { createAgent${toolImport} } from "@etagents/sdk";${zodImport}${mcpImport}
${toolDefs}${mcpDefs}// ---------------------------------------------------------------------------
// Agent
// ---------------------------------------------------------------------------

const ${varName} = createAgent({
  name: "${name}",
  systemPrompt: "You are a helpful assistant. Be concise and accurate.",
  tools: ${toolsList},
${mcpList}});

export default ${varName};
`;
}
