import type { CompleteEvent, RunEvent } from "../../types/run.js";
import type { BudgetEvent } from "../../types/budget.js";
import type {
  TurnStartEvent,
  TurnEndEvent,
  TextDeltaEvent,
  TextDoneEvent,
  ToolCallEvent,
  ToolResultEvent,
  ErrorEvent,
} from "../../types/run.js";

// ---------------------------------------------------------------------------
// ReadyState
// ---------------------------------------------------------------------------

/** Human-readable alias for the connection state. */
export type ReadyState = "connecting" | "open" | "closed";

// ---------------------------------------------------------------------------
// Handler type
// ---------------------------------------------------------------------------

export type SessionEventHandler<T = unknown> = (data: T) => void;

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface SessionEventSourceOptions {
  /** POST body — serialised as JSON. Required for sending prompt + session ID. */
  body?: Record<string, unknown>;
  /** Additional request headers. */
  headers?: Record<string, string>;
  /** AbortSignal — cancel the connection on component unmount or navigation. */
  signal?: AbortSignal;
  /** HTTP method. Defaults to "POST" when `body` is provided, otherwise "GET". */
  method?: "GET" | "POST";
}

// ---------------------------------------------------------------------------
// Typed event map
// ---------------------------------------------------------------------------

/**
 * EtaEventMap — maps SSE wire event names to their payload types.
 *
 * `run.status`  → turn_start, turn_end, warning, exceeded events
 * `run.text.delta` → text_delta events
 * `run.text.done`  → text_done events
 * `tool.invoke` → tool_call event
 * `tool.result` → tool_result event
 * `run.error`   → error event
 * `run.done`    → complete event (carries the full RunResult)
 */
export interface EtaEventMap {
  "run.status": TurnStartEvent | TurnEndEvent | BudgetEvent;
  "run.text.delta": TextDeltaEvent;
  "run.text.done": TextDoneEvent;
  "tool.invoke": ToolCallEvent;
  "tool.result": ToolResultEvent;
  "run.error": ErrorEvent;
  "run.done": CompleteEvent;
  /** Synthetic event dispatched when the connection opens. */
  open: void;
  /** Synthetic event dispatched when the connection closes. */
  close: void;
  /** Catch-all for any event name not in the typed map above. */
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Internal async queue — backs the async iterator
// ---------------------------------------------------------------------------

interface QueuedItem {
  event: string;
  data: unknown;
}

class EventQueue {
  private readonly items: QueuedItem[] = [];
  private readonly resolvers: Array<(item: IteratorResult<QueuedItem>) => void> = [];
  private done = false;

  push(item: QueuedItem): void {
    const resolve = this.resolvers.shift();
    if (resolve) {
      resolve({ value: item, done: false });
    } else {
      this.items.push(item);
    }
  }

  finish(): void {
    this.done = true;
    for (const resolve of this.resolvers.splice(0)) {
      resolve({ value: undefined as unknown as QueuedItem, done: true });
    }
  }

  next(): Promise<IteratorResult<QueuedItem>> {
    const item = this.items.shift();
    if (item !== undefined) {
      return Promise.resolve({ value: item, done: false });
    }
    if (this.done) {
      return Promise.resolve({ value: undefined as unknown as QueuedItem, done: true });
    }
    return new Promise((resolve) => {
      this.resolvers.push(resolve);
    });
  }
}

// ---------------------------------------------------------------------------
// SSE parser — builds a stateful line-by-line parser
// ---------------------------------------------------------------------------

type DispatchFn = (event: string, data: string) => void;

function createSseParser(dispatch: DispatchFn): (line: string) => void {
  let currentEvent = "message";
  let dataLines: string[] = [];

  return (line: string) => {
    if (line === "") {
      // Blank line → dispatch
      if (dataLines.length > 0) {
        dispatch(currentEvent, dataLines.join("\n"));
      }
      // Reset for next event
      currentEvent = "message";
      dataLines = [];
      return;
    }

    if (line.startsWith("event:")) {
      currentEvent = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trimStart());
    }
    // Ignore id:, retry:, and comment lines (":...")
  };
}

// ---------------------------------------------------------------------------
// SessionEventSource — fetch-based SSE consumer
// ---------------------------------------------------------------------------

/**
 * SessionEventSource — typed, fetch-based SSE client.
 *
 * Unlike the native `EventSource`, this implementation:
 *  - Supports **POST bodies** (send `{ prompt, sessionId }` together)
 *  - Accepts an **AbortSignal** for cancellation
 *  - Provides a **typed `EtaEventMap`** for compile-time safety
 *  - Exposes a **`result` promise** that resolves when `run.done` fires
 *  - Supports **`for await`** async iteration over all events
 *
 * Usage:
 * ```ts
 * const src = new SessionEventSource("/api/agent", {
 *   body: { prompt: "Hello", sessionId: "abc123" },
 *   signal: controller.signal,
 * });
 * src.on("run.done", (data) => console.log("done", data.result));
 * src.on("tool.invoke", (call) => console.log("tool", call));
 * await src.result;
 * ```
 */
export class SessionEventSource {
  private _readyState: ReadyState = "connecting";
  private readonly handlers = new Map<string, SessionEventHandler[]>();
  private readonly queue = new EventQueue();
  private readonly ctrl: AbortController;

  /**
   * Resolves with the `CompleteEvent` when `run.done` fires.
   * Rejects if the connection closes with an error or is aborted.
   */
  readonly result: Promise<CompleteEvent>;

  constructor(url: string, options: SessionEventSourceOptions = {}) {
    this.ctrl = new AbortController();

    // Chain caller's signal to our controller
    if (options.signal) {
      options.signal.addEventListener("abort", () => this.ctrl.abort(), { once: true });
    }

    this.result = this._connect(url, options);
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /** Current connection state. */
  get readyState(): ReadyState {
    return this._readyState;
  }

  /**
   * Register a typed event handler.
   * Returns `this` for chaining.
   */
  on<K extends keyof EtaEventMap>(event: K, handler: SessionEventHandler<EtaEventMap[K]>): this {
    const list = this.handlers.get(event as string) ?? [];
    list.push(handler as SessionEventHandler);
    this.handlers.set(event as string, list);
    return this;
  }

  /** Close the SSE connection immediately. */
  close(): void {
    this.ctrl.abort();
  }

  /** Async iteration over all received events. */
  [Symbol.asyncIterator](): AsyncIterator<{ event: string; data: unknown }> {
    return {
      next: () => this.queue.next() as Promise<IteratorResult<{ event: string; data: unknown }>>,
    };
  }

  // ---------------------------------------------------------------------------
  // Connection + stream loop
  // ---------------------------------------------------------------------------

  private async _connect(url: string, options: SessionEventSourceOptions): Promise<CompleteEvent> {
    const method = options.method ?? (options.body ? "POST" : "GET");

    const headers: Record<string, string> = {
      Accept: "text/event-stream",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    };

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: this.ctrl.signal,
      });
    } catch (err) {
      this._readyState = "closed";
      this.queue.finish();
      this._dispatch("close", undefined);
      throw err;
    }

    if (!response.ok || !response.body) {
      this._readyState = "closed";
      this.queue.finish();
      this._dispatch("close", undefined);
      throw new Error(`SSE connection failed: ${response.status} ${response.statusText}`);
    }

    this._readyState = "open";
    this._dispatch("open", undefined);

    // Decode bytes → lines → SSE events
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let remainder = "";

    let doneEvent: CompleteEvent | undefined;

    const dispatchParsed = (eventName: string, rawData: string) => {
      let data: unknown = rawData;
      try {
        data = JSON.parse(rawData);
      } catch {
        // non-JSON data — keep as string
      }

      this._dispatch(eventName, data);
      this.queue.push({ event: eventName, data });

      if (eventName === "run.done") {
        doneEvent = data as CompleteEvent;
      }
    };

    const parseLine = createSseParser(dispatchParsed);

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = remainder + decoder.decode(value, { stream: true });
        const lines = chunk.split("\n");
        // Last segment may be incomplete — save for next read
        remainder = lines.pop() ?? "";

        for (const line of lines) {
          parseLine(line);
        }
      }

      // Flush any remainder
      if (remainder) parseLine(remainder);
    } catch (err) {
      if ((err as { name?: string }).name !== "AbortError") {
        this._dispatch("run.error", { kind: "error", message: String(err), code: "STREAM_ERROR" });
      }
    } finally {
      this._readyState = "closed";
      this.queue.finish();
      this._dispatch("close", undefined);
    }

    if (!doneEvent) {
      throw new Error("SSE stream closed before run.done was received");
    }

    return doneEvent;
  }

  private _dispatch(event: string, data: unknown): void {
    const list = this.handlers.get(event);
    if (list) {
      for (const handler of list) {
        handler(data);
      }
    }
  }
}
