import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";

export type LLMProvider = "anthropic" | "openai" | "ollama";

export interface LLMConfig {
  provider?: LLMProvider;
  apiKey?: string;
  model?: string;
  maxTokens?: number;
  baseURL?: string;
  /** Per-attempt timeout in ms. See DEFAULT_TIMEOUT_MS. */
  timeout?: number;
  /** Retries per call. See DEFAULT_MAX_RETRIES. */
  maxRetries?: number;
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

// Overridable with LLM_MODEL. A deliberation fans out to five agents, so the
// default favours a fast, cheap model that still returns well-formed JSON.
const DEFAULT_MODELS: Record<LLMProvider, string> = {
  anthropic: "claude-sonnet-4-20250514",
  openai: "gpt-5.4-mini",
  ollama: "qwen3.5:9b",
};

const DEFAULT_MAX_TOKENS: Record<LLMProvider, number> = {
  anthropic: 4096,
  openai: 4096,
  ollama: 4096,
};

/**
 * Per-attempt timeout, in ms.
 *
 * Both SDKs default to ten minutes, and that is per *attempt* — with two
 * retries a single call can hold a slot for half an hour. A deliberation makes
 * its five calls one after another, from a job on a five-minute timer, so the
 * defaults let one stuck call outlive several scheduling periods. Two minutes
 * is generous for a 2-4k token completion and turns a hang into a failure the
 * caller can fall back from.
 */
const DEFAULT_TIMEOUT_MS = 120_000;

/**
 * Retries are kept: they fire on 429s and 5xx, and a failed attempt returns no
 * completion, so it costs latency rather than tokens.
 */
const DEFAULT_MAX_RETRIES = 2;

export interface LLMModelUsage {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  /** Calls that returned no usage block, so their tokens are unaccounted for. */
  callsWithoutUsage: number;
}

export interface LLMUsageSnapshot extends LLMModelUsage {
  since: string;
  byModel: Record<string, LLMModelUsage>;
}

const emptyUsage = (): LLMModelUsage => ({
  calls: 0,
  inputTokens: 0,
  outputTokens: 0,
  callsWithoutUsage: 0,
});

/**
 * Process-wide token accounting.
 *
 * Both providers already return their usage block and every caller threw it
 * away, so nothing in this system had ever measured its own spend — every
 * figure about it was a model of the code rather than an observation of it.
 *
 * The totals live here, below the clients, rather than at the call sites:
 * each agent constructs its own LLMClient and the moderator a fifth, so a
 * per-instance counter would have to be summed by someone who knows all five
 * exist. Recording in chat() means a new caller is counted by default instead
 * of by remembering to.
 *
 * In-memory and reset by a restart. That is the right scope for a rate — for
 * a bill, read the provider's own dashboard.
 */
let usageSince = new Date().toISOString();
const usageTotals = emptyUsage();
const usageByModel = new Map<string, LLMModelUsage>();

function recordUsage(response: LLMResponse): void {
  const model = usageByModel.get(response.model) ?? emptyUsage();
  usageTotals.calls += 1;
  model.calls += 1;
  if (response.usage) {
    usageTotals.inputTokens += response.usage.inputTokens;
    usageTotals.outputTokens += response.usage.outputTokens;
    model.inputTokens += response.usage.inputTokens;
    model.outputTokens += response.usage.outputTokens;
  } else {
    usageTotals.callsWithoutUsage += 1;
    model.callsWithoutUsage += 1;
  }
  usageByModel.set(response.model, model);
}

/**
 * Totals since process start, or since the last reset.
 *
 * `model` is what the provider said it answered with, not what was requested —
 * the two differ when a model id resolves to a dated snapshot, and the
 * difference is exactly what a cost question needs to know.
 */
export function getLLMUsage(): LLMUsageSnapshot {
  return {
    ...usageTotals,
    since: usageSince,
    byModel: Object.fromEntries(usageByModel),
  };
}

export function resetLLMUsage(): void {
  usageTotals.calls = 0;
  usageTotals.inputTokens = 0;
  usageTotals.outputTokens = 0;
  usageTotals.callsWithoutUsage = 0;
  usageByModel.clear();
  usageSince = new Date().toISOString();
}

export class LLMClient {
  /**
   * Whether a model wants `max_completion_tokens` rather than `max_tokens`.
   *
   * Matched by family prefix, not an allowlist of exact ids: OpenAI ships new
   * point releases regularly, and an allowlist would silently break every call
   * the day a newer one is configured. The reasoning families (o-series, and
   * gpt-5 onwards) use the newer field; anything older keeps `max_tokens`.
   */
  static usesMaxCompletionTokens(model: string): boolean {
    const id = model.toLowerCase();
    if (/^o\d/.test(id)) return true; // o1, o3, o4, …
    const gpt = id.match(/^gpt-(\d+)/);
    return gpt ? Number(gpt[1]) >= 5 : false;
  }

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

    const limits = {
      timeout: config.timeout ?? DEFAULT_TIMEOUT_MS,
      maxRetries: config.maxRetries ?? DEFAULT_MAX_RETRIES,
    };

    if (this.provider === "ollama") {
      // Ollama exposes an OpenAI-compatible API; apiKey is unused server-side
      this.openaiClient = new OpenAI({
        apiKey: config.apiKey || "ollama",
        baseURL: config.baseURL,
        ...limits,
      });
    } else if (config.apiKey) {
      if (this.provider === "anthropic") {
        this.anthropicClient = new Anthropic({ apiKey: config.apiKey, ...limits });
      } else {
        this.openaiClient = new OpenAI({
          apiKey: config.apiKey,
          baseURL: config.baseURL,
          ...limits,
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

    // Counted here rather than in each branch, so a future provider is
    // accounted for without anyone remembering to add it.
    let response: LLMResponse;
    if (this.provider === "anthropic" && this.anthropicClient) {
      response = await this.chatWithAnthropic(systemPrompt, userMessage);
    } else if (
      (this.provider === "openai" || this.provider === "ollama") &&
      this.openaiClient
    ) {
      response = await this.chatWithOpenAI(systemPrompt, userMessage);
    } else {
      throw new Error(`Unknown provider: ${this.provider}`);
    }

    recordUsage(response);
    return response;
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
    // Newer OpenAI models reject `max_tokens` outright ("Unsupported parameter
    // ... use 'max_completion_tokens' instead"), so sending the old name fails
    // every call rather than degrading. Older models and Ollama's
    // OpenAI-compatible endpoint only understand `max_tokens`, so the field
    // name is chosen per model rather than switched globally.
    const tokenLimit = LLMClient.usesMaxCompletionTokens(this.model)
      ? { max_completion_tokens: this.maxTokens }
      : { max_tokens: this.maxTokens };

    const response = await this.openaiClient!.chat.completions.create({
      model: this.model,
      ...tokenLimit,
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
