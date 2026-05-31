import { SessionEventStream, SSE_HEADERS } from "../event-stream.js";
import type { StreamOptions } from "../stream-options.js";
import type { AgentDef } from "../../types/domain/agent.js";

// ---------------------------------------------------------------------------
// Minimal Next.js App Router type surface
// Avoids a hard dependency on the `next` package.
// ---------------------------------------------------------------------------

/** Minimal shape of a Next.js App Router Request that this handler requires. */
export interface NextRouteRequest {
  text(): Promise<string>;
}

/** Route handler function type for the Next.js App Router. */
export type NextRouteHandler = (req: NextRouteRequest) => Promise<Response>;

// ---------------------------------------------------------------------------
// NextResponseOptions
// ---------------------------------------------------------------------------

/**
 * Options for `toNextResponse()` and `toNextHandler()`.
 *
 * Extends `StreamOptions` (adds `onEvent` hook support) with response-level
 * controls so callers can inject custom headers or override the status code
 * without wrapping in a second `new Response()`.
 */
export interface NextResponseOptions extends StreamOptions {
  /** Extra HTTP headers merged with `SSE_HEADERS`. */
  headers?: Record<string, string>;
  /** HTTP status code. Defaults to 200. */
  status?: number;
}

// ---------------------------------------------------------------------------
// toNextHandler
// ---------------------------------------------------------------------------

/**
 * toNextHandler — wraps an `AgentDef` as a Next.js App Router route handler.
 *
 * Place in `app/api/agent/route.ts`:
 * ```ts
 * import { toNextHandler } from "@etagents/sdk/http";
 * export const POST = toNextHandler(agent);
 * ```
 *
 * The handler reads the request body as plain text, starts a run, and
 * streams SSE events back using `SessionEventStream`.
 */
export function toNextHandler(
  agent: AgentDef,
  options?: NextResponseOptions,
): NextRouteHandler {
  return async (req: NextRouteRequest): Promise<Response> => {
    const input = await req.text();
    return toNextResponse(new SessionEventStream(agent), input, options);
  };
}

// ---------------------------------------------------------------------------
// toNextResponse
// ---------------------------------------------------------------------------

/**
 * toNextResponse — wraps a `SessionEventStream` + input into a streaming SSE
 * `Response`, giving the caller full control over request parsing.
 *
 * Use when `toNextHandler` is too opinionated — for example, when you need to
 * parse a JSON body with multiple fields:
 *
 * ```ts
 * export async function POST(req: Request) {
 *   const { prompt, clientRequestId } = await req.json();
 *   const stream = new SessionEventStream(agent);
 *   stream.send("request_id", { clientRequestId });
 *   return toNextResponse(stream, prompt, {
 *     config: { signal: req.signal, metadata: { clientRequestId } },
 *     headers: { "X-Request-Id": clientRequestId },
 *   });
 * }
 * ```
 */
export function toNextResponse(
  stream: SessionEventStream,
  input: string,
  options?: NextResponseOptions,
): Response {
  const body = stream.stream(input, options);
  const headers: Record<string, string> = {
    ...SSE_HEADERS,
    ...options?.headers,
  };
  return new Response(body, { headers, status: options?.status ?? 200 });
}
