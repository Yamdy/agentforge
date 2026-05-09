import { registerProvider } from '../src/model-resolver.js';
import type { LanguageModel } from 'ai';

export interface MockModelOptions {
  text?: string;
  inputTokens?: number;
  outputTokens?: number;
}

export function createMockLanguageModel(opts: MockModelOptions = {}): LanguageModel {
  const text = opts.text ?? 'Hello!';
  const inputTokens = opts.inputTokens ?? 10;
  const outputTokens = opts.outputTokens ?? 5;

  return {
    modelId: 'mock-model',
    specificationVersion: 'v3',
    provider: 'mock',
    supportedUrls: {},
    async doGenerate() {
      return {
        text,
        usage: { inputTokens, outputTokens },
        finishReason: 'stop',
      } as any;
    },
    async doStream() {
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue({
            type: 'text-delta',
            id: 'text-1',
            delta: text,
          });
          controller.enqueue({
            type: 'finish',
            finishReason: { unified: 'stop', raw: undefined },
            usage: {
              inputTokens: { total: inputTokens, noCache: inputTokens },
              outputTokens: { total: outputTokens, text: outputTokens },
            },
          } as any);
          controller.close();
        },
      });
      return { stream } as any;
    },
  };
}

export function registerMockProvider(
  providerName: string,
  modelFactory?: (modelId: string) => LanguageModel,
): void {
  registerProvider(
    providerName,
    modelFactory ?? (() => createMockLanguageModel()),
  );
}
