import type { Message } from "../../types/message.js";

// ---------------------------------------------------------------------------
// MessageQueue — manages message history for a single run
// ---------------------------------------------------------------------------

/**
 * MessageQueue — append-only message store with trimming support.
 *
 * `all()` returns an immutable snapshot (shallow copy) so callers cannot
 * accidentally mutate the internal buffer through the returned array.
 *
 * `trim()` protects system messages and removes the oldest non-system
 * messages first, preserving context anchors.
 */
export class MessageQueue {
  private readonly buf: Message[] = [];

  push(message: Message): void {
    this.buf.push(message);
  }

  /** Returns a shallow-copy snapshot of the current history. */
  all(): Message[] {
    return [...this.buf];
  }

  /**
   * Trims oldest non-system messages until `buf.length <= maxMessages`.
   * System messages are never removed.
   */
  trim(maxMessages: number): void {
    let i = 0;
    while (this.buf.length > maxMessages && i < this.buf.length) {
      if (this.buf[i].role !== "system") {
        this.buf.splice(i, 1);
      } else {
        i++;
      }
    }
  }
}
