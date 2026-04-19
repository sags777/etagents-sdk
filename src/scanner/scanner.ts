import fs from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

/** A discovered agent file. */
export interface ScannedAgent {
  /** Absolute path to the agent file. */
  file: string;
}

/** A discovered MCP config file. */
export interface ScannedMcp {
  /** Absolute path to the config file. */
  file: string;
  serverName?: string;
  transport?: string;
}

/** Result returned by {@link ToolScanner.scan}. */
export interface ScanResult {
  agents: ScannedAgent[];
  mcpConfigs: ScannedMcp[];
}

/** Options controlling what {@link ToolScanner.scan} looks for. */
export interface ScanOptions {
  /** Scan for `*.agent.ts` / `*.agent.js` files. Default: `true`. */
  agents?: boolean;
  /** Scan for `*.mcp.json` files. Default: `false`. */
  mcp?: boolean;
}

// ---------------------------------------------------------------------------
// ToolScanner
// ---------------------------------------------------------------------------

/**
 * ToolScanner — filesystem discovery for agent files and MCP configs.
 *
 * Walks a directory tree (skipping `node_modules` and dotfiles), collecting:
 *   - `*.agent.ts` / `*.agent.js`   → {@link ScannedAgent}
 *   - `*.mcp.json`                  → {@link ScannedMcp}
 *
 * @example
 * ```ts
 * const result = await ToolScanner.scan("./src/agents", { mcp: true });
 * for (const a of result.agents) console.log(a.file);
 * ```
 */
export class ToolScanner {
  /**
   * Scan `directory` for agent files and/or MCP configs.
   *
   * @param directory - Root directory to scan (resolved relative to `process.cwd()`).
   * @param options   - Controls what file types are collected.
   * @returns A {@link ScanResult} with agents and mcpConfigs arrays.
   */
  static scan(directory: string, options: ScanOptions = {}): ScanResult {
    const { agents: scanAgents = true, mcp: scanMcp = false } = options;

    const resolved = path.resolve(directory);

    if (!fs.existsSync(resolved)) {
      throw new Error(`ToolScanner: directory "${resolved}" does not exist.`);
    }

    const agents: ScannedAgent[] = [];
    const mcpConfigs: ScannedMcp[] = [];

    walk(resolved, (file) => {
      if (scanAgents && (file.endsWith(".agent.ts") || file.endsWith(".agent.js"))) {
        agents.push({ file });
        return;
      }

      if (scanMcp && file.endsWith(".mcp.json")) {
        try {
          const raw = JSON.parse(fs.readFileSync(file, "utf-8")) as {
            serverName?: string;
            transport?: string;
          };
          mcpConfigs.push({ file, serverName: raw.serverName, transport: raw.transport });
        } catch {
          mcpConfigs.push({ file });
        }
      }
    });

    return { agents, mcpConfigs };
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function walk(dir: string, cb: (file: string) => void): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      walk(path.join(dir, entry.name), cb);
    } else if (entry.isFile()) {
      cb(path.join(dir, entry.name));
    }
  }
}
