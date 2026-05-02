import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";

export type LLMProvider = "anthropic" | "openai" | "ollama";

export interface LLMConfig {
  provider?: LLMProvider;
  apiKey?: string;
  model?: string;
  maxTokens?: number;
  baseURL?: string;
}

export interface LLMMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface LLMResponse {
  content: string;
  model: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

const DEFAULT_MODELS: Record<LLMProvider, string> = {
  anthropic: "claude-sonnet-4-20250514",
  openai: "gpt-4o",
  ollama: "qwen3.5:9b",
};

const DEFAULT_MAX_TOKENS: Record<LLMProvider, number> = {
  anthropic: 4096,
  openai: 4096,
  ollama: 4096,
};

export class LLMClient {
  private anthropicClient: Anthropic | null = null;
  private openaiClient: OpenAI | null = null;
  private provider: LLMProvider;
  private model: string;
  private maxTokens: number;

  constructor(config: LLMConfig = {}) {
    // Auto-detect provider based on API key if not specified
    if (!config.provider) {
      if (config.apiKey?.startsWith("sk-ant-")) {
        this.provider = "anthropic";
      } else if (config.apiKey?.startsWith("sk-")) {
        this.provider = "openai";
      } else {
        this.provider = "anthropic"; // default
      }
    } else {
      this.provider = config.provider;
    }

    this.model = config.model || DEFAULT_MODELS[this.provider];
    this.maxTokens = config.maxTokens || DEFAULT_MAX_TOKENS[this.provider];

    if (this.provider === "ollama") {
      // Ollama exposes an OpenAI-compatible API; apiKey is unused server-side
      this.openaiClient = new OpenAI({
        apiKey: config.apiKey || "ollama",
        baseURL: config.baseURL,
      });
    } else if (config.apiKey) {
      if (this.provider === "anthropic") {
        this.anthropicClient = new Anthropic({ apiKey: config.apiKey });
      } else {
        this.openaiClient = new OpenAI({
          apiKey: config.apiKey,
          baseURL: config.baseURL,
        });
      }
    }
  }

  get isAvailable(): boolean {
    return this.anthropicClient !== null || this.openaiClient !== null;
  }

  get currentProvider(): LLMProvider {
    return this.provider;
  }

  get currentModel(): string {
    return this.model;
  }

  async chat(
    systemPrompt: string,
    userMessage: string
  ): Promise<LLMResponse> {
    if (!this.isAvailable) {
      throw new Error("LLM client not initialized - API key required");
    }

    if (this.provider === "anthropic" && this.anthropicClient) {
      return this.chatWithAnthropic(systemPrompt, userMessage);
    } else if (
      (this.provider === "openai" || this.provider === "ollama") &&
      this.openaiClient
    ) {
      return this.chatWithOpenAI(systemPrompt, userMessage);
    }

    throw new Error(`Unknown provider: ${this.provider}`);
  }

  private async chatWithAnthropic(
    systemPrompt: string,
    userMessage: string
  ): Promise<LLMResponse> {
    const response = await this.anthropicClient!.messages.create({
      model: this.model,
      max_tokens: this.maxTokens,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    });

    const content = response.content[0];
    if (content.type !== "text") {
      throw new Error("Unexpected response type from Anthropic");
    }

    return {
      content: content.text,
      model: response.model,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
    };
  }

  private async chatWithOpenAI(
    systemPrompt: string,
    userMessage: string
  ): Promise<LLMResponse> {
    const response = await this.openaiClient!.chat.completions.create({
      model: this.model,
      max_tokens: this.maxTokens,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error("Empty response from OpenAI");
    }

    return {
      content,
      model: response.model,
      usage: response.usage
        ? {
            inputTokens: response.usage.prompt_tokens,
            outputTokens: response.usage.completion_tokens,
          }
        : undefined,
    };
  }
}

// Factory function to create LLM client from environment
export function createLLMClient(config?: Partial<LLMConfig>): LLMClient {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  // Prefer Anthropic if both are available, or use whichever is available
  let apiKey = config?.apiKey;
  let provider = config?.provider;

  if (!apiKey) {
    if (anthropicKey) {
      apiKey = anthropicKey;
      provider = provider || "anthropic";
    } else if (openaiKey) {
      apiKey = openaiKey;
      provider = provider || "openai";
    }
  }

  return new LLMClient({
    provider,
    apiKey,
    model: config?.model,
    maxTokens: config?.maxTokens,
  });
}
