// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

export type Role = "system" | "user" | "assistant" | "tool";

// ---------------------------------------------------------------------------
// Tool call / result records
// ---------------------------------------------------------------------------

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ToolResult {
  toolCallId: string;
  content: string;
  isError: boolean;
}

// ---------------------------------------------------------------------------
// Message
// ---------------------------------------------------------------------------

export interface Message {
  role: Role;
  content: string;
  /** Present when role is "assistant" and the model requested tool calls */
  toolCalls?: ToolCall[];
  /** Present when role is "tool" — links this result back to the call */
  toolCallId?: string;
  /**
   * Surrogate identifier for this message.
   * Optional for backward compat — the kernel generates one on construction
   * when persisting to a normalized backend.
   */
  messageId?: string;
}
