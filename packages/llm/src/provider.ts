import { Effect } from "effect";
import {
  LLMProvider,
  LLMGenerateParams,
  LLMError,
  LLMConfig,
  Message,
} from "./types";

export class OpenAICompatibleProvider implements LLMProvider {
  private readonly config: LLMConfig;

  constructor(config: LLMConfig) {
    this.config = config;
  }

  generate(params: LLMGenerateParams): Effect.Effect<string, LLMError> {
    return Effect.tryPromise({
      try: async () => {
        const response = await fetch(`${this.config.baseURL}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.config.apiKey}`,
          },
          body: JSON.stringify({
            model: params.model || this.config.model,
            messages: params.messages,
            temperature: params.temperature ?? this.config.temperature,
            max_tokens: params.maxTokens ?? this.config.maxTokens,
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`HTTP ${response.status}: ${errorText}`);
        }

        const data = await response.json();
        return data.choices[0]?.message?.content || "";
      },
      catch: (e) =>
        new LLMError(
          `LLM generation failed: ${e instanceof Error ? e.message : String(e)}`,
          e
        ),
    });
  }
}
