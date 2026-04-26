import { SessionEventStream, SSE_HEADERS, type StreamOptions } from "../event-stream/event-stream.js";
import type { AgentDef } from "../../types/agent.js";

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
  options?: StreamOptions,
): NextRouteHandler {
  return async (req: NextRouteRequest): Promise<Response> => {
    const input = await req.text();
    const eventStream = new SessionEventStream(agent);
    const body = eventStream.stream(input, options);
    return new Response(body, { headers: SSE_HEADERS });
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
 *   const { prompt, runId } = await req.json();
 *   const stream = new SessionEventStream(agent);
 *   stream.send("run_id", { runId });   // push run ID before kernel starts
 *   return toNextResponse(stream, prompt, { config: { runId, signal: req.signal } });
 * }
 * ```
 */
export function toNextResponse(
  stream: SessionEventStream,
  input: string,
  options?: StreamOptions,
): Response {
  const body = stream.stream(input, options);
  return new Response(body, { headers: SSE_HEADERS });
}
