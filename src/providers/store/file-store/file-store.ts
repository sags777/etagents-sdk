import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { StoreProvider, WriteOptions } from "../../../interfaces/store.js";
import { StoreError } from "../../../errors.js";

/**
 * Wrapper persisted to disk. `_expiresAt` is a Unix epoch (ms) or null.
 */
interface FileEntry<T> {
  value: T;
  _expiresAt: number | null;
}

/**
 * FileStore — filesystem-backed StoreProvider.
 *
 * Key schema: `{baseDir}/{key}.json`
 *   Slashes in the key map to directory separators, so:
 *   key `"sessions/abc"` → `{baseDir}/sessions/abc.json`
 *
 * Writes are atomic: data is written to a `.tmp` sibling and renamed into
 * place so a crash never leaves a corrupt file — the previous content is
 * preserved until the rename succeeds.
 *
 * TTL is stored as `_expiresAt` inside the JSON payload.  Expired entries are
 * deleted on `read()` and treated as misses.
 */
export class FileStore implements StoreProvider {
  constructor(private readonly baseDir: string) {}

  async read<T = unknown>(key: string): Promise<T | null> {
    const filePath = this.resolve(key);
    let raw: string;
    try {
      raw = await readFile(filePath, "utf-8");
    } catch (err: unknown) {
      if (isEnoent(err)) return null;
      throw new StoreError(`read("${key}") failed: ${String(err)}`);
    }

    let entry: FileEntry<T>;
    try {
      entry = JSON.parse(raw) as FileEntry<T>;
    } catch (err) {
      throw new StoreError(`read("${key}") corrupt JSON: ${String(err)}`);
    }

    if (entry._expiresAt !== null && Date.now() > entry._expiresAt) {
      // Best-effort cleanup; never throw if delete fails
      unlink(filePath).catch(() => undefined);
      return null;
    }

    return entry.value;
  }

  async write<T = unknown>(key: string, value: T, options?: WriteOptions): Promise<void> {
    const filePath = this.resolve(key);
    const _expiresAt =
      options?.ttlMs != null ? Date.now() + options.ttlMs : null;

    const entry: FileEntry<T> = { value, _expiresAt };
    const payload = JSON.stringify(entry);
    const tmpPath = filePath + ".tmp." + process.pid;

    try {
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(tmpPath, payload, "utf-8");
      await rename(tmpPath, filePath);
    } catch (err) {
      // Clean up the tmp file if rename failed
      unlink(tmpPath).catch(() => undefined);
      throw new StoreError(`write("${key}") failed: ${String(err)}`);
    }
  }

  async remove(key: string): Promise<void> {
    try {
      await unlink(this.resolve(key));
    } catch (err: unknown) {
      if (isEnoent(err)) return;
      throw new StoreError(`remove("${key}") failed: ${String(err)}`);
    }
  }

  async list(prefix: string): Promise<string[]> {
    const dir = join(this.baseDir, ...prefix.split("/"));
    let names: string[];
    try {
      names = await readdir(dir);
    } catch (err: unknown) {
      if (isEnoent(err)) return [];
      throw new StoreError(`list("${prefix}") failed: ${String(err)}`);
    }

    return names
      .filter((n) => n.endsWith(".json"))
      .map((n) => prefix + "/" + n.slice(0, -5));
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private resolve(key: string): string {
    return join(this.baseDir, ...key.split("/")) + ".json";
  }
}

function isEnoent(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as NodeJS.ErrnoException).code === "ENOENT"
  );
}
