import { SessionEventStream, SSE_HEADERS, type StreamOptions } from "../event-stream/event-stream.js";
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
 * app.post("/agent", toExpressHandler(agent));
 * ```
 *
 * The handler reads `req.body` as a string, starts a run, and pipes SSE
 * events to the response using `SessionEventStream`.
 */
export function toExpressHandler(
  agent: AgentDef,
  options?: StreamOptions,
): ExpressHandler {
  return (req: ExpressRequest, res: ExpressResponse): void => {
    const input =
      typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? "");

    for (const [name, value] of Object.entries(SSE_HEADERS)) {
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
