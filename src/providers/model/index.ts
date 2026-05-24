/**
 * @module @etagents/sdk/providers/model
 *
 * Built-in ModelProvider implementations for Anthropic, OpenAI, Azure, and Gemini.
 * Includes MockModel for deterministic testing and shared streaming utilities.
 */

export {
  MockModel,
  type MockResponse,
  type MockToolCall,
} from "./mock/mock.js";
export {
  AnthropicModel,
  type AnthropicModelConfig,
} from "./anthropic/anthropic.js";
export { OpenAIModel, type OpenAIModelConfig } from "./openai/openai.js";
export { AzureModel, type AzureModelConfig } from "./azure/azure.js";
export { GeminiModel, type GeminiModelConfig } from "./gemini/gemini.js";
