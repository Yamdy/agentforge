/**
 * OpenAI LLM Adapter for production agent.
 */

import { createOpenAI } from '@ai-sdk/openai';
import type { LLMAdapter } from 'agentforge';

const openai = createOpenAI({
  apiKey: process.env['OPENAI_API_KEY'],
});

const model = openai('gpt-4o');

export const adapter: LLMAdapter = {
  async generate(prompt: string) {
    const result = await model.doGenerate({
      inputFormat: 'prompt',
      mode: { type: 'regular' },
      prompt,
    });

    return {
      content: result.text ?? '',
      finishReason: result.finishReason ?? 'stop',
      usage: result.usage
        ? {
            promptTokens: result.usage.promptTokens,
            completionTokens: result.usage.completionTokens,
            totalTokens: result.usage.totalTokens,
          }
        : undefined,
    };
  },

  async *stream(prompt: string) {
    const stream = model.doStream({
      inputFormat: 'prompt',
      mode: { type: 'regular' },
      prompt,
    });
    for await (const result of stream) {
      yield { delta: (result as any).text ?? '', done: false };
    }
    yield { delta: '', done: true };
  },
};