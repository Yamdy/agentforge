/**
 * OpenAI LLM Adapter for production agent.
 */

import { createOpenAI } from '@ai-sdk/openai';
import type { LLMAdapter } from 'agentforge';
import { from } from 'rxjs';
import { map } from 'rxjs/operators';

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

  stream(prompt: string) {
    return from(
      model.doStream({
        inputFormat: 'prompt',
        mode: { type: 'regular' },
        prompt,
      })
    ).pipe(
      map((streamResult: { stream: { text: string } }) => ({
        delta: streamResult.stream.text ?? '',
        done: false,
      }))
    );
  },
};