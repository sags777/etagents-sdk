/**
 * @module cli/commands/memory
 *
 * `eta memory <search|index>` — Vector memory / RAG management.
 */

import type { Command } from "commander";

export function register(program: Command): void {
  program
    .command("memory <subcommand>")
    .description("Manage vector memory for RAG: search | index")
    .option("--redis-url <url>", "Redis URL (default: redis://127.0.0.1:6379)")
    .option("--namespace <ns>", "Memory namespace", "default")
    .option("--vector-dim <n>", "Embedding vector dimensions", Number, 1536)
    .option("--top-k <n>", "Number of search results", Number, 5)
    .option("--min-score <n>", "Minimum similarity score", Number)
    .option("--ttl-days <n>", "TTL for indexed entries in days", Number)
    .option("--embedder-key <key>", "OpenAI API key for embeddings")
    .option("--scope <scope>", "Memory scope: agent | session | user", "agent")
    .option("--session-id <id>", "Session ID (used for indexing)")
    .option("--store <spec>", "Session store for indexing: file:<dir> or redis:<url>", "file:.sessions")
    .option("--json", "Machine-readable JSON output")
    .argument("[query]", "Search query (for search subcommand)")
    .action(async (
      subcommand: string,
      query: string | undefined,
      opts: Record<string, unknown>,
    ) => {
      switch (subcommand) {
        case "index":
          return memoryIndex(opts);
        case "search":
          return memorySearch(query, opts);
        default:
          console.error(`Unknown subcommand: "${subcommand}". Valid: search, index`);
          process.exit(1);
      }
    });
}

interface MemoryOpts {
  redisUrl?: string;
  namespace?: string;
  vectorDim?: number;
  topK?: number;
  minScore?: number;
  ttlDays?: number;
  embedderKey?: string;
  scope?: string;
  sessionId?: string;
  store?: string;
  json?: boolean;
}

async function resolveMemory(opts: MemoryOpts) {
  const embedderKey = opts.embedderKey ?? process.env.OPENAI_API_KEY ?? "";
  if (!embedderKey) {
    console.error("Error: Embedding API key required. Use --embedder-key or set OPENAI_API_KEY.");
    process.exit(1);
  }

  const { RedisMemory } = await import("../../providers/memory/index.js");

  // Minimal OpenAI embedder
  const embedder = {
    async embed(text: string): Promise<number[]> {
      const res = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: { "Authorization": `Bearer ${embedderKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "text-embedding-3-small", input: text }),
      });
      const json = await res.json() as { data: Array<{ embedding: number[] }> };
      return json.data[0].embedding;
    },
  };

  return RedisMemory.connect({
    url: opts.redisUrl ?? process.env.REDIS_URL ?? "redis://127.0.0.1:6379",
    namespace: opts.namespace ?? "default",
    embedder,
    vectorDim: opts.vectorDim ?? 1536,
    ttlDays: opts.ttlDays,
  });
}

async function memoryIndex(opts: MemoryOpts): Promise<void> {
  const { sessionId, store: storeSpec = "file:.sessions" } = opts;
  if (!sessionId) {
    console.error("Error: --session-id is required.");
    process.exit(1);
  }

  // Load messages from store
  let messages: Array<{ role: string; content: string }> | undefined;
  const SESSION_PREFIX = "eta:run:";

  if (storeSpec.startsWith("redis:")) {
    const { RedisStore } = await import("../../providers/store/index.js");
    const rs = await RedisStore.connect({ url: storeSpec.slice("redis:".length), namespace: "cli" });
    const snap = await rs.read<{ messages?: Array<{ role: string; content: string }> }>(`${SESSION_PREFIX}${sessionId}`);
    await rs.quit();
    messages = snap?.messages;
  } else {
    const { FileStore } = await import("../../providers/store/index.js");
    const dir = storeSpec.startsWith("file:") ? storeSpec.slice("file:".length) : storeSpec;
    const fs = new FileStore(dir || ".sessions");
    const snap = await fs.read<{ messages?: Array<{ role: string; content: string }> }>(`${SESSION_PREFIX}${sessionId}`);
    messages = snap?.messages;
  }

  if (!messages || messages.length === 0) {
    console.error(`No messages found for session "${sessionId}".`);
    process.exit(1);
  }

  const memory = await resolveMemory(opts);
  let indexed = 0;
  const namespace = opts.namespace ?? "default";
  for (const msg of messages) {
    if (msg.role === "assistant" || msg.role === "user") {
      await memory.index({
        id: `${sessionId}:${indexed}`,
        text: msg.content,
        scope: { agentId: "cli", namespace },
        metadata: { role: msg.role },
      });
      indexed++;
    }
  }

  await memory.quit();
  console.log(`Indexed ${indexed} messages from session "${sessionId}".`);
}

async function memorySearch(query: string | undefined, opts: MemoryOpts): Promise<void> {
  if (!query) {
    console.error('Error: Missing search query. Usage: eta memory search "your query"');
    process.exit(1);
  }

  const memory = await resolveMemory(opts);
  const namespace = opts.namespace ?? "default";
  const results = await memory.search(query, {
    scope: { agentId: "cli", namespace },
    limit: opts.topK,
    minScore: opts.minScore,
  });
  await memory.quit();

  if (opts.json) {
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  if (results.length === 0) {
    console.log("No relevant memories found.");
    return;
  }

  console.log(`\nFound ${results.length} memories:\n`);
  for (let i = 0; i < results.length; i++) {
    console.log(`  ${i + 1}. [score=${results[i].score.toFixed(3)}] ${results[i].text}`);
  }
  console.log();
}
