import { Effect, pipe } from "effect";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import {
  generateText,
  streamText,
  tool,
  zodSchema,
  type ModelMessage,
  type Tool,
} from "ai";
import { Message } from "@agentforge/core";
import {
  LLMProvider,
  LLMGenerateParams,
  LLMError,
  LLMConfig,
  StreamEvent,
  LLMStreamProvider,
  LLMGenerateResult,
} from "./types";
import { normalizeMessages } from "./normalize";

function toModelMessage(
  msgs: Message[],
  systemPrompt?: string
): ModelMessage[] {
  const result: ModelMessage[] = [];

  // 添加 system 消息（如果存在）
  if (systemPrompt) {
    result.push({ role: "system", content: systemPrompt });
  }

  for (const msg of msgs) {
    // AI SDK v3: tool 消息的 content 必须是数组，包含 tool-result
    if (msg.role === "tool") {
      result.push({
        role: "tool",
        content: [
          {
            type: "tool-result" as const,
            toolCallId: msg.toolCallId ?? msg.toolName ?? "unknown",
            toolName: msg.toolName ?? "unknown",
            output: { type: "text" as const, value: msg.content },
          },
        ],
      });
    } else if (msg.role === "assistant" && Array.isArray(msg.content)) {
      result.push({
        role: msg.role,
        content: msg.content,
      });
    } else {
      result.push({
        role: msg.role as "user" | "assistant" | "system",
        content: msg.content,
      });
    }
  }

  // 归一化消息，处理不同模型的特殊需求
  return normalizeMessages(result);
}

export class OpenAICompatibleProvider
  implements LLMProvider, LLMStreamProvider
{
  private readonly config: LLMConfig;
  private readonly languageModel;

  constructor(config: LLMConfig) {
    this.config = config;
    const openaiCompatible = createOpenAICompatible({
      name: "openai-compatible",
      baseURL: config.baseURL,
      apiKey: config.apiKey,
    });

    this.languageModel = openaiCompatible.chatModel(config.model);
  }

  generate(params: LLMGenerateParams): Effect.Effect<LLMGenerateResult, LLMError> {
    return Effect.tryPromise({
      try: async () => {
        const messages = toModelMessage(params.messages, params.systemPrompt);

        const tools = params.tools?.reduce<Record<string, Tool>>((acc, t) => {
          acc[t.name] = tool({
            description: t.description,
            inputSchema: zodSchema(t.parameters),
            execute: async (args: Record<string, unknown>) => {
              return args;
            },
          });
          return acc;
        }, {});

        const result = await generateText({
          model: this.languageModel,
          messages,
          temperature: params.temperature ?? this.config.temperature,
          maxOutputTokens: params.maxTokens ?? this.config.maxTokens,
          tools,
        });

        const toolCalls = result.toolCalls?.map((tc) => ({
          id: tc.toolCallId,
          name: tc.toolName,
          parameters: typeof tc.input === "string" ? JSON.parse(tc.input) : tc.input,
        }));

        return {
          text: result.text,
          toolCalls,
        };
      },
      catch: (e) =>
        new LLMError(
          `LLM generation failed: ${e instanceof Error ? e.message : String(e)}`,
          e
        ),
    });
  }

  generateStream(
    params: LLMGenerateParams
  ): Effect.Effect<AsyncIterable<StreamEvent>, LLMError> {
    return Effect.tryPromise({
      try: async () => {
        const messages = toModelMessage(params.messages, params.systemPrompt);

        const tools = params.tools?.reduce<Record<string, Tool>>((acc, t) => {
          acc[t.name] = tool({
            description: t.description,
            inputSchema: zodSchema(t.parameters),
            execute: async (args: Record<string, unknown>) => {
              return args;
            },
          });
          return acc;
        }, {});

        const result = streamText({
          model: this.languageModel,
          messages,
          temperature: params.temperature ?? this.config.temperature,
          maxOutputTokens: params.maxTokens ?? this.config.maxTokens,
          tools,
        });

        async function* gen(): AsyncGenerator<StreamEvent> {
          for await (const event of result.fullStream) {
            switch (event.type) {
              case "text-delta":
                yield { type: "text-delta", content: event.text };
                break;
              case "tool-call":
                yield {
                  type: "tool-call-start",
                  toolCallId: event.toolCallId,
                  toolName: event.toolName,
                };
                break;
              case "finish": {
                const finalText = await result.text;
                const toolCallsResult = await result.toolCalls;
                const toolCalls = toolCallsResult?.map((tc) => ({
                  id: tc.toolCallId,
                  name: tc.toolName,
                  parameters: typeof tc.input === "string" ? JSON.parse(tc.input) : tc.input,
                })) ?? [];
                yield { type: "done", text: finalText, toolCalls };
                break;
              }
            }
          }
        }

        return gen();
      },
      catch: (e) =>
        new LLMError(
          `LLM stream generation failed: ${e instanceof Error ? e.message : String(e)}`,
          e
        ),
    });
  }
}