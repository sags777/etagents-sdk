/**
 * @module @etagents/sdk/interfaces
 *
 * Provider contracts — stable, frozen, zero dependencies.
 * Implementors build against these; the kernel consumes them.
 */

export type {
  // model
  ModelProvider,
  ModelMessage,
  MessageRole,
  ContentPart,
  TextPart,
  ImagePart,
  ToolDefinition,
  CompletionOptions,
  ModelResponse,
  FinishReason,
  TokenUsage,
  StreamChunk,
  TextChunk,
  ToolStartChunk,
  ToolDeltaChunk,
  ToolEndChunk,
  FinishChunk,
} from "./model.js";

export type {
  // memory
  MemoryProvider,
  MemoryEntry,
  MemoryScope,
  MemorySearchOptions,
  MemoryMatch,
} from "./memory.js";

export type {
  // store
  StoreProvider,
  WriteOptions,
} from "./store.js";

export type {
  // privacy
  PrivacyProvider,
  PrivacyMap,
  MaskResult,
  EncryptedMap,
} from "./privacy.js";
