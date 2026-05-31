/**
 * @module @etagents/sdk/http
 *
 * HTTP/SSE transport. Framework-agnostic core plus Next.js and Express adapters.
 */

export { SessionEventStream, SSE_HEADERS } from "./event-stream.js";
export type { StreamTarget } from "./event-stream.js";
export type { StreamOptions } from "./stream-options.js";

export { SessionEventSource } from "./event-source.js";
export type {
  ReadyState,
  SessionEventHandler,
  SessionEventSourceOptions,
  EtaEventMap,
} from "./event-source.js";

export { toNextHandler, toNextResponse } from "./adapters/next.js";
export type {
  NextRouteRequest,
  NextRouteHandler,
  NextResponseOptions,
} from "./adapters/next.js";

export { toExpressHandler } from "./adapters/express.js";
export type {
  ExpressRequest,
  ExpressResponse,
  ExpressHandler,
  ExpressHandlerOptions,
} from "./adapters/express.js";
