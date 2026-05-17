import type { TokenCounter, Message } from '@primo-ai/sdk';
import { getEncoding, type Tiktoken } from 'js-tiktoken';

type ModelEncodings =
  | 'o200k_base'
  | 'cl100k_base'
  | 'p50k_base'
  | 'r50k_base'
  | 'gpt2';

const MODEL_ENCODING_MAP: Record<string, ModelEncodings> = {
  'gpt-4o': 'o200k_base',
  'gpt-4o-mini': 'o200k_base',
  'o1': 'o200k_base',
  'o1-mini': 'o200k_base',
  'o3': 'o200k_base',
  'o3-mini': 'o200k_base',
  'gpt-4-turbo': 'cl100k_base',
  'gpt-4': 'cl100k_base',
  'gpt-4-32k': 'cl100k_base',
  'gpt-3.5-turbo': 'cl100k_base',
  'text-embedding-ada-002': 'cl100k_base',
  'text-embedding-3-small': 'cl100k_base',
  'text-embedding-3-large': 'cl100k_base',
  'claude': 'cl100k_base',
  'deepseek': 'cl100k_base',
  'gemini': 'cl100k_base',
};

const PER_MSG_OVERHEAD = 4;
const NAME_OVERHEAD = 1;

function resolveEncodingName(model?: string): ModelEncodings {
  if (!model) return 'cl100k_base';
  for (const [prefix, enc] of Object.entries(MODEL_ENCODING_MAP)) {
    if (model.toLowerCase().startsWith(prefix)) return enc;
  }
  return 'cl100k_base';
}

export class TiktokenCounter implements TokenCounter {
  private cache = new Map<string, Tiktoken>();

  private getEncoder(encoding: ModelEncodings): Tiktoken {
    let enc = this.cache.get(encoding);
    if (!enc) {
      enc = getEncoding(encoding);
      this.cache.set(encoding, enc);
    }
    return enc;
  }

  count(text: string, model?: string): number {
    const encoding = resolveEncodingName(model);
    const enc = this.getEncoder(encoding);
    return enc.encode(text).length;
  }

  countMessages(messages: Message[], model?: string): number {
    const encoding = resolveEncodingName(model);
    const enc = this.getEncoder(encoding);
    let total = 0;
    for (const msg of messages) {
      total += PER_MSG_OVERHEAD;
      total += (msg as unknown as { name?: string }).name ? NAME_OVERHEAD : 0;
      total += enc.encode(msg.content).length;
      if (msg.role === 'assistant' && 'toolCalls' in msg && msg.toolCalls) {
        for (const tc of msg.toolCalls) {
          total += enc.encode(tc.name).length;
          total += enc.encode(JSON.stringify(tc.args)).length;
        }
      }
      if (msg.role === 'assistant' && 'reasoningContent' in msg && msg.reasoningContent) {
        total += enc.encode(msg.reasoningContent).length;
      }
      if (msg.role === 'tool' && 'result' in msg && msg.result !== undefined) {
        total += enc.encode(JSON.stringify(msg.result)).length;
      }
    }
    total += 2;
    return total;
  }

  dispose(): void {
    this.cache.clear();
  }
}
