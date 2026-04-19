import { Effect } from "effect";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText } from "ai";
import {
  LLMProvider,
  LLMGenerateParams,
  LLMError,
  LLMConfig,
  Message,
} from "./types";

function injectSystemPrompt(
  messages: Message[],
  systemPrompt?: string
): Message[] {
  if (!systemPrompt) {
    return messages;
  }

  const hasSystemMessage = messages.some((m) => m.role === "system");
  if (hasSystemMessage) {
    return messages;
  }

  return [
    { role: "system", content: systemPrompt },
    ...messages,
  ];
}

export class OpenAICompatibleProvider implements LLMProvider {
  private readonly config: LLMConfig;

  constructor(config: LLMConfig) {
    this.config = config;
  }

  generate(params: LLMGenerateParams): Effect.Effect<string, LLMError> {
    return Effect.tryPromise({
      try: async () => {
        const openaiCompatible = createOpenAICompatible({
          baseURL: this.config.baseURL,
          apiKey: this.config.apiKey,
        } as any);

        const model = openaiCompatible.chatModel(
          params.model || this.config.model
        ) as any;

        const messages = injectSystemPrompt(
          params.messages as Message[],
          params.systemPrompt
        );

        const result = await generateText({
          model,
          messages,
          temperature: params.temperature ?? this.config.temperature,
        });

        return result.text;
      },
      catch: (e) =>
        new LLMError(
          `LLM generation failed: ${e instanceof Error ? e.message : String(e)}`,
          e
        ),
    });
  }
}
