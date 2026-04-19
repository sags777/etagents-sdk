import { OpenAIModel, type OpenAIModelConfig } from "../openai/openai.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface AzureModelConfig {
  /** Azure OpenAI endpoint, e.g. https://my-resource.openai.azure.com */
  endpoint: string;
  apiKey: string;
  /** Deployment name (maps to the model in Azure). */
  deployment: string;
  /** Azure API version, e.g. "2024-02-01". */
  apiVersion: string;
}

// ---------------------------------------------------------------------------
// AzureModel
// ---------------------------------------------------------------------------

/**
 * AzureModel — Azure OpenAI streaming adapter, extending OpenAIModel.
 *
 * Azure-specific differences from standard OpenAI:
 *   - URL: `{endpoint}/openai/deployments/{deployment}/chat/completions?api-version={apiVersion}`
 *   - Auth: `api-key` header instead of `Authorization: Bearer`
 */
export class AzureModel extends OpenAIModel {
  private constructor(config: OpenAIModelConfig, chatUrl: string) {
    super(config);
    this.chatUrl = chatUrl;
  }

  static create(config: AzureModelConfig): AzureModel {
    const chatUrl =
      `${config.endpoint.replace(/\/$/, "")}/openai/deployments/${config.deployment}` +
      `/chat/completions?api-version=${config.apiVersion}`;
    return new AzureModel({ apiKey: config.apiKey, model: config.deployment }, chatUrl);
  }

  protected override buildHeaders(): Record<string, string> {
    return {
      "content-type": "application/json",
      "api-key": this.apiKey,
    };
  }
}
