/**
 * Shared HTTP helper for non-streaming JSON POST requests.
 *
 * Auth headers differ per provider — the caller assembles them and passes them in.
 * This helper handles the common fetch + error handling + JSON deserialization pattern.
 *
 * For streaming SSE responses use `fetch()` directly and pipe the response body
 * to `sseLines()` from `./sse.js`.
 */

export interface PostJSONConfig {
  url: string;
  headers: Record<string, string>;
  body: unknown;
  signal?: AbortSignal;
}

/**
 * POST a JSON body and return the parsed response.
 * Throws an `Error` with the status and response text when the response is not ok.
 */
export async function postJSON<T>(config: PostJSONConfig): Promise<T> {
  const resp = await fetch(config.url, {
    method: "POST",
    headers: { "content-type": "application/json", ...config.headers },
    body: JSON.stringify(config.body),
    signal: config.signal,
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => resp.statusText);
    throw new Error(`HTTP ${resp.status}: ${errText}`);
  }

  return resp.json() as Promise<T>;
}
