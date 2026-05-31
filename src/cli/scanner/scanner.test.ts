import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { ToolScanner } from "./scanner.js";

let baseDir: string;

beforeEach(async () => {
  baseDir = await mkdtemp(join(tmpdir(), "eta-tool-scanner-"));
});

afterEach(async () => {
  await rm(baseDir, { recursive: true, force: true });
});

async function writeFixture(filePath: string, content = ""): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");
}

describe("ToolScanner", () => {
  it("discovers agent files recursively while skipping hidden paths and node_modules", async () => {
    const rootAgent = join(baseDir, "alpha.agent.ts");
    const nestedAgent = join(baseDir, "nested", "beta.agent.js");
    const ignoredNodeModulesAgent = join(
      baseDir,
      "node_modules",
      "pkg",
      "ignored.agent.ts",
    );
    const ignoredHiddenDirAgent = join(
      baseDir,
      ".hidden",
      "ignored.agent.js",
    );
    const ignoredHiddenFileAgent = join(baseDir, ".secret.agent.ts");

    await writeFixture(rootAgent, "export const agent = 'alpha';\n");
    await writeFixture(nestedAgent, "export const agent = 'beta';\n");
    await writeFixture(ignoredNodeModulesAgent, "ignored\n");
    await writeFixture(ignoredHiddenDirAgent, "ignored\n");
    await writeFixture(ignoredHiddenFileAgent, "ignored\n");
    await writeFixture(join(baseDir, "notes.txt"), "not an agent\n");
    await writeFixture(
      join(baseDir, "server.mcp.json"),
      JSON.stringify({ serverName: "local", transport: "stdio" }),
    );

    const result = ToolScanner.scan(baseDir);

    expect(result.agents.map((agent) => agent.file).sort()).toEqual(
      [rootAgent, nestedAgent].sort(),
    );
    expect(result.mcpConfigs).toEqual([]);
  });

  it("supports MCP-only scans and keeps malformed MCP configs discoverable", async () => {
    const validMcp = join(baseDir, "configs", "server.mcp.json");
    const invalidMcp = join(baseDir, "configs", "broken.mcp.json");

    await writeFixture(
      validMcp,
      JSON.stringify({ serverName: "search", transport: "sse" }),
    );
    await writeFixture(invalidMcp, "{not-json");
    await writeFixture(join(baseDir, "gamma.agent.ts"), "export const agent = true;\n");

    const result = ToolScanner.scan(baseDir, { agents: false, mcp: true });

    expect(result.agents).toEqual([]);
    expect(result.mcpConfigs.sort((a, b) => a.file.localeCompare(b.file))).toEqual([
      { file: invalidMcp },
      { file: validMcp, serverName: "search", transport: "sse" },
    ]);
  });

  it("throws when the scan root does not exist", () => {
    expect(() => ToolScanner.scan(join(baseDir, "missing"))).toThrow(
      `ToolScanner: directory "${join(baseDir, "missing")}" does not exist.`,
    );
  });
});