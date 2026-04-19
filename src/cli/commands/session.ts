/**
 * @module cli/commands/session
 *
 * `eta session <list|get|delete>` — Session management.
 *
 * Store spec: file:<dir> (default: file:.sessions) or redis:<url>
 */

import type { Command } from "commander";
import type { StoreProvider } from "../../interfaces/store.js";
import { FileStore } from "../../providers/store/index.js";

const SESSION_PREFIX = "eta:run:";

async function resolveStore(spec: string): Promise<StoreProvider & { quit?: () => Promise<void> }> {
  if (spec.startsWith("redis:")) {
    const url = spec.slice("redis:".length);
    const { RedisStore } = await import("../../providers/store/index.js");
    return RedisStore.connect({ url, namespace: "cli" });
  }
  const dir = spec.startsWith("file:") ? spec.slice("file:".length) : spec;
  return new FileStore(dir || ".sessions");
}

export function register(program: Command): void {
  program
    .command("session <subcommand>")
    .description("Manage persisted sessions: list | get | delete")
    .option("--store <spec>", "Storage backend: file:<dir> or redis:<url>", "file:.sessions")
    .option("--session-id <id>", "Target session (run) ID")
    .option("--json", "Machine-readable JSON output")
    .action(async (
      subcommand: string,
      opts: { store?: string; sessionId?: string; json?: boolean },
    ) => {
      const spec = opts.store ?? "file:.sessions";

      switch (subcommand) {
        case "list":
          return sessionList(spec, opts.json ?? false);
        case "get":
          return sessionGet(spec, opts.sessionId, opts.json ?? false);
        case "delete":
          return sessionDelete(spec, opts.sessionId);
        default:
          console.error(`Unknown subcommand: "${subcommand}". Valid: list, get, delete`);
          process.exit(1);
      }
    });
}

async function sessionList(spec: string, json: boolean): Promise<void> {
  const store = await resolveStore(spec);

  // FileStore scan — list all session keys
  if (spec.startsWith("file:") || !spec.startsWith("redis:")) {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const dir = spec.startsWith("file:") ? spec.slice("file:".length) : spec;
    const resolvedDir = path.resolve(dir || ".sessions");

    if (!fs.existsSync(resolvedDir)) {
      console.log(json ? "[]" : "No sessions found.");
      return;
    }

    const files = fs.readdirSync(resolvedDir).filter((f: string) => f.endsWith(".json"));
    const sessions: Array<{ runId: string; updatedAt: string; turns: number }> = [];

    for (const file of files) {
      try {
        const raw = fs.readFileSync(path.join(resolvedDir, file), "utf-8");
        const parsed = JSON.parse(raw) as { value?: { runId?: string; updatedAt?: string; messages?: unknown[] } };
        const snap = parsed.value ?? parsed as { runId?: string; updatedAt?: string; messages?: unknown[] };
        if (snap.runId) {
          sessions.push({
            runId: snap.runId,
            updatedAt: snap.updatedAt ?? "",
            turns: Math.floor(((snap.messages?.length ?? 0) - 1) / 2),
          });
        }
      } catch {
        // Skip corrupt files
      }
    }

    if (json) {
      console.log(JSON.stringify(sessions, null, 2));
    } else {
      if (sessions.length === 0) {
        console.log("No sessions found.");
        return;
      }
      console.log(`\nSessions (${sessions.length}):\n`);
      for (const s of sessions) {
        console.log(`  ${s.runId}  updated=${s.updatedAt}  turns=${s.turns}`);
      }
      console.log();
    }
    return;
  }

  // Redis — use store.list if available
  const listable = store as StoreProvider & { list?: (prefix?: string) => Promise<string[]> };
  if (typeof listable.list === "function") {
    const keys = await listable.list(SESSION_PREFIX);
    if (json) {
      console.log(JSON.stringify(keys, null, 2));
    } else {
      console.log(`Sessions:\n${keys.map((k) => `  ${k}`).join("\n")}`);
    }
  } else {
    console.error("List is not supported for this store backend.");
    process.exit(1);
  }

  await store.quit?.();
}

async function sessionGet(spec: string, sessionId: string | undefined, json: boolean): Promise<void> {
  if (!sessionId) {
    console.error("Error: --session-id is required.");
    process.exit(1);
  }
  const store = await resolveStore(spec);
  const snap = await store.read(`${SESSION_PREFIX}${sessionId}`);
  await store.quit?.();

  if (!snap) {
    console.error(`Session "${sessionId}" not found.`);
    process.exit(1);
  }

  if (json) {
    console.log(JSON.stringify(snap, null, 2));
  } else {
    const s = snap as { runId?: string; updatedAt?: string; messages?: unknown[] };
    console.log(`\nSession: ${s.runId}`);
    console.log(`Updated: ${s.updatedAt}`);
    console.log(`Messages: ${s.messages?.length ?? 0}`);
    console.log();
  }
}

async function sessionDelete(spec: string, sessionId: string | undefined): Promise<void> {
  if (!sessionId) {
    console.error("Error: --session-id is required.");
    process.exit(1);
  }
  const store = await resolveStore(spec);
  await store.remove(`${SESSION_PREFIX}${sessionId}`);
  await store.quit?.();
  console.log(`Deleted session "${sessionId}".`);
}
