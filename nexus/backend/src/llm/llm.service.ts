import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
// The package index does not re-export the LLM module, so the client comes from
// that module's own entry point. `GeminiClient` is the class this package
// actually ships; `LLMClient` is only the name of its interface, `ILLMClient`.
import { GeminiClient } from '@bridge-2026/agentic-consensus/dist/llm';

@Injectable()
export class LLMService {
  private llmClient?: GeminiClient;

  constructor(private configService: ConfigService) {
    const apiKey = this.configService.get<string>('GEMINI_API_KEY');
    if (!apiKey) {
      console.warn('GEMINI_API_KEY not set, LLM features will be disabled');
    } else {
      this.llmClient = new GeminiClient({
        apiKey,
        model: 'gemini-pro',
      });
    }
  }

  async generateText(prompt: string): Promise<string> {
    const response = await this.client().generate(prompt);
    return response.text;
  }

  async generateStructured<T>(
    prompt: string,
    schema: Record<string, unknown>,
  ): Promise<T> {
    return this.client().generateStructured<T>(prompt, schema);
  }

  private client(): GeminiClient {
    if (!this.llmClient) {
      throw new Error('LLM client not initialized. Please set GEMINI_API_KEY.');
    }
    return this.llmClient;
  }
}
