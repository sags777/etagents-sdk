/**
 * @module @etagents/sdk/http
 *
 * HTTP/SSE transport. Framework-agnostic core plus Next.js and Express adapters.
 */

export { SessionEventStream, SSE_HEADERS } from "./event-stream/event-stream.js";
export type { StreamOptions } from "./stream-options.js";

export { SessionEventSource } from "./event-source/event-source.js";
export type {
  ReadyState,
  SessionEventHandler,
  SessionEventSourceOptions,
  EtaEventMap,
} from "./event-source/event-source.js";

export { toNextHandler, toNextResponse } from "./next/next.js";
export type { NextRouteRequest, NextRouteHandler, NextResponseOptions } from "./next/next.js";

export { toExpressHandler } from "./express/express.js";
export type { ExpressRequest, ExpressResponse, ExpressHandler, ExpressHandlerOptions } from "./express/express.js";
