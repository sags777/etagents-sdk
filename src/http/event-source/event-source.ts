// ---------------------------------------------------------------------------
// ReadyState
// ---------------------------------------------------------------------------

/** Human-readable alias for the underlying EventSource.readyState integer. */
export type ReadyState = "connecting" | "open" | "closed";

// ---------------------------------------------------------------------------
// Handler type
// ---------------------------------------------------------------------------

export type SessionEventHandler<T = unknown> = (data: T) => void;

// ---------------------------------------------------------------------------
// EtaEventSource — client-side SSE consumer
// ---------------------------------------------------------------------------

/**
 * SessionEventSource — typed wrapper around the browser `EventSource` API.
 *
 * Listens for SSE events from a `SessionEventStream` endpoint and dispatches
 * them to typed handlers registered via `.on()`.
 *
 * Usage:
 * ```ts
 * const src = new SessionEventSource("/api/agent");
 * src
 *   .on("run.done", (data) => console.log("done", data))
 *   .on("run.error", (err) => console.error(err))
 *   .on("tool.invoke", (call) => console.log("tool", call));
 * ```
 */
export class SessionEventSource {
  private readonly source: EventSource;

  constructor(url: string) {
    this.source = new EventSource(url);
  }

  /** Current connection state. */
  get readyState(): ReadyState {
    switch (this.source.readyState) {
      case EventSource.CONNECTING:
        return "connecting";
      case EventSource.OPEN:
        return "open";
      default:
        return "closed";
    }
  }

  /**
   * Register a handler for a named SSE event.
   * Returns `this` for chaining.
   */
  on<T = unknown>(event: string, handler: SessionEventHandler<T>): this {
    this.source.addEventListener(event, (e: Event) => {
      const me = e as MessageEvent<string>;
      try {
        handler(JSON.parse(me.data) as T);
      } catch {
        // malformed JSON — discard
      }
    });
    return this;
  }

  /** Close the SSE connection. */
  close(): void {
    this.source.close();
  }
}
