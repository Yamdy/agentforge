import { registerProvider } from '../src/model-resolver.js';
import type { LanguageModel } from 'ai';

export interface MockModelOptions {
  text?: string;
  inputTokens?: number;
  outputTokens?: number;
}

const defaultUsage = {
  inputTokens: { total: 10, noCache: 10 },
  outputTokens: { total: 5, text: 5 },
};

export function createMockLanguageModel(opts: MockModelOptions = {}): LanguageModel {
  const text = opts.text ?? 'Hello!';
  const usage = {
    inputTokens: { total: opts.inputTokens ?? 10, noCache: opts.inputTokens ?? 10 },
    outputTokens: { total: opts.outputTokens ?? 5, text: opts.outputTokens ?? 5 },
  };

  return {
    modelId: 'mock-model',
    specificationVersion: 'v3',
    provider: 'mock',
    supportedUrls: {},
    async doGenerate() {
      return {
        content: [{ type: 'text' as const, text }],
        finishReason: { unified: 'stop' as const, raw: 'stop' },
        usage,
      } as any;
    },
    async doStream() {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue({ type: 'text-start', id: 'text-1' });
          controller.enqueue({ type: 'text-delta', id: 'text-1', delta: text });
          controller.enqueue({ type: 'text-end', id: 'text-1' });
          controller.enqueue({
            type: 'finish',
            finishReason: { unified: 'stop', raw: 'stop' },
            usage,
          });
          controller.close();
        },
      });
      return { stream } as any;
    },
  };
}

export interface MockToolCallModelOptions {
  toolName: string;
  toolCallId?: string;
  args?: Record<string, unknown>;
  finalText?: string;
}

export function createMockModelWithToolCalls(
  steps: MockToolCallModelOptions[],
  finalText: string = 'Done',
): LanguageModel {
  let callCount = 0;
  return {
    modelId: 'mock-tool-calls',
    specificationVersion: 'v3',
    provider: 'mock',
    supportedUrls: {},
    async doGenerate() {
      const idx = callCount++;
      if (idx < steps.length) {
        const step = steps[idx];
        return {
          content: [{
            type: 'tool-call' as const,
            toolCallId: step.toolCallId ?? `call-${idx}`,
            toolName: step.toolName,
            input: JSON.stringify(step.args ?? {}),
          }],
          finishReason: { unified: 'tool-calls' as const, raw: 'tool-calls' },
          usage: defaultUsage,
        } as any;
      }
      return {
        content: [{ type: 'text' as const, text: finalText }],
        finishReason: { unified: 'stop' as const, raw: 'stop' },
        usage: defaultUsage,
      } as any;
    },
    async doStream() {
      const idx = callCount++;
      const stream = new ReadableStream({
        start(controller) {
          if (idx < steps.length) {
            const step = steps[idx];
            controller.enqueue({
              type: 'tool-call',
              toolCallId: step.toolCallId ?? `call-${idx}`,
              toolName: step.toolName,
              input: JSON.stringify(step.args ?? {}),
            });
            controller.enqueue({
              type: 'finish',
              finishReason: { unified: 'tool-calls', raw: 'tool-calls' },
              usage: defaultUsage,
            });
          } else {
            controller.enqueue({ type: 'text-start', id: 'text-1' });
            controller.enqueue({ type: 'text-delta', id: 'text-1', delta: finalText });
            controller.enqueue({ type: 'text-end', id: 'text-1' });
            controller.enqueue({
              type: 'finish',
              finishReason: { unified: 'stop', raw: 'stop' },
              usage: defaultUsage,
            });
          }
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
