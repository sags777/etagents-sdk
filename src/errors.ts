/**
 * EtaError — base class for all SDK-originated errors.
 *
 * Every subclass carries a `code` string for programmatic handling so
 * callers can distinguish error categories without string-matching messages.
 */
export class EtaError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "EtaError";
    this.code = code;
    // Restore prototype chain in transpiled environments
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ---------------------------------------------------------------------------
// Provider errors
// ---------------------------------------------------------------------------

export class ModelError extends EtaError {
  constructor(message: string, options?: ErrorOptions) {
    super("MODEL_ERROR", message, options);
    this.name = "ModelError";
  }
}

export class StoreError extends EtaError {
  constructor(message: string, options?: ErrorOptions) {
    super("STORE_ERROR", message, options);
    this.name = "StoreError";
  }
}

export class MemoryError extends EtaError {
  constructor(message: string, options?: ErrorOptions) {
    super("MEMORY_ERROR", message, options);
    this.name = "MemoryError";
  }
}

export class PrivacyError extends EtaError {
  constructor(message: string, options?: ErrorOptions) {
    super("PRIVACY_ERROR", message, options);
    this.name = "PrivacyError";
  }
}

// ---------------------------------------------------------------------------
// Runtime errors
// ---------------------------------------------------------------------------

export class ToolError extends EtaError {
  constructor(message: string, options?: ErrorOptions) {
    super("TOOL_ERROR", message, options);
    this.name = "ToolError";
  }
}

export class McpError extends EtaError {
  constructor(message: string, options?: ErrorOptions) {
    super("MCP_ERROR", message, options);
    this.name = "McpError";
  }
}

export class BudgetError extends EtaError {
  constructor(message: string, options?: ErrorOptions) {
    super("BUDGET_ERROR", message, options);
    this.name = "BudgetError";
  }
}

export class CheckpointError extends EtaError {
  constructor(message: string, options?: ErrorOptions) {
    super("CHECKPOINT_ERROR", message, options);
    this.name = "CheckpointError";
  }
}
