import { SessionEventStream, SSE_HEADERS } from "../event-stream/event-stream.js";
import type { StreamOptions } from "../types.js";
import type { AgentDef } from "../../types/agent.js";

// ---------------------------------------------------------------------------
// Minimal Express type surface
// Avoids a hard dependency on the `express` package.
// ---------------------------------------------------------------------------

/** Minimal shape of an Express Request that this handler requires. */
export interface ExpressRequest {
  body: unknown;
}

/** Minimal shape of an Express Response that this handler requires. */
export interface ExpressResponse {
  setHeader(name: string, value: string): void;
  write(chunk: Uint8Array | string): boolean;
  end(): void;
}

/** Express middleware / route handler type. */
export type ExpressHandler = (req: ExpressRequest, res: ExpressResponse) => void;

// ---------------------------------------------------------------------------
// ExpressHandlerOptions — extends StreamOptions with response-level controls
// ---------------------------------------------------------------------------

/**
 * ExpressHandlerOptions — all options accepted by `toExpressHandler()`.
 *
 * Extends `StreamOptions` with extra response headers merged on top of
 * `SSE_HEADERS` so callers can inject CORS, tracing, or custom headers
 * without wrapping the handler.
 */
export interface ExpressHandlerOptions extends StreamOptions {
  /** Extra HTTP headers merged with `SSE_HEADERS`. */
  headers?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// toExpressHandler
// ---------------------------------------------------------------------------

/**
 * toExpressHandler — wraps an `AgentDef` as an Express route handler.
 *
 * ```ts
 * import express from "express";
 * import { toExpressHandler } from "@etagents/sdk/http";
 *
 * const app = express();
 * app.use(express.text());
 * app.post("/agent", toExpressHandler(agent, {
 *   headers: { "Access-Control-Allow-Origin": "*" },
 * }));
 * ```
 *
 * The handler reads `req.body` as a string, starts a run, and pipes SSE
 * events to the response using `SessionEventStream`.
 */
export function toExpressHandler(
  agent: AgentDef,
  options?: ExpressHandlerOptions,
): ExpressHandler {
  return (req: ExpressRequest, res: ExpressResponse): void => {
    const input =
      typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? "");

    const allHeaders = { ...SSE_HEADERS, ...options?.headers };
    for (const [name, value] of Object.entries(allHeaders)) {
      res.setHeader(name, value);
    }

    const eventStream = new SessionEventStream(agent);
    const stream = eventStream.stream(input, options);
    const reader = stream.getReader();

    function pump(): void {
      reader
        .read()
        .then(({ done, value }) => {
          if (done) {
            res.end();
            return;
          }
          res.write(value);
          pump();
        })
        .catch(() => res.end());
    }

    pump();
  };
}
