/**
 * OpenAIEmbedder — text embedding via OpenAI embeddings API.
 *
 * Internal to the memory module. Not re-exported from the barrel.
 * Default model: text-embedding-3-small (1536 dimensions).
 */

interface EmbeddingAPIResponse {
  data: Array<{ embedding: number[] }>;
}

export interface OpenAIEmbedderConfig {
  apiKey: string;
  /** Embedding model. Defaults to "text-embedding-3-small". */
  model?: string;
  /** Override base URL for proxies / local models. */
  baseUrl?: string;
}

export class OpenAIEmbedder {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;

  constructor(config: OpenAIEmbedderConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model ?? "text-embedding-3-small";
    this.baseUrl = (config.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "");
  }

  async embed(text: string): Promise<number[]> {
    const res = await fetch(`${this.baseUrl}/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ input: text, model: this.model }),
    });

    if (!res.ok) {
      throw new Error(`OpenAI embeddings error: ${res.status} ${res.statusText}`);
    }

    const json = (await res.json()) as EmbeddingAPIResponse;
    return json.data[0].embedding;
  }
}
