/**
 * SSE parsing utilities shared across all streaming model providers.
 */

/**
 * Parse a ReadableStream of SSE bytes into individual `data:` payloads.
 * Skips empty lines, comments, and the `[DONE]` sentinel.
 */
export async function* sseLines(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  try {
    while (!signal?.aborted) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (line.startsWith("data:")) {
          const data = line.slice(5).trim();
          if (data && data !== "[DONE]") yield data;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
