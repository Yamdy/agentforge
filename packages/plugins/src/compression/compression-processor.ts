import type { CompressionStrategy, Message, TokenCounter } from '@primo-ai/sdk';

export type { Message };

export type SummarizeFn = (messages: Message[]) => Promise<string>;

export type CompressionPhase =
  | { type: 'truncate'; maxTokens: number }
  | { type: 'summarize'; model: string; maxTokens: number; summarizeFn?: SummarizeFn }
  | { type: 'prune'; keepRecent: number };

export interface CompressionConfig {
  maxContextTokens: number;
  phases: CompressionPhase[];
}

function applyTruncate(messages: Message[], tc: TokenCounter, maxTokens: number): Message[] {
  const result: Message[] = [];
  let budget = maxTokens;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    const cost = tc.count(m.content);
    if (cost > budget) {
      const truncated = { ...m, content: m.content.slice(0, Math.floor(budget * 4)) + '...' };
      result.unshift(truncated);
      break;
    }
    result.unshift(m);
    budget -= cost;
  }
  return result;
}

function applyPrune(messages: Message[], keepRecent: number): Message[] {
  return messages.slice(-keepRecent);
}

async function applySummarize(
  messages: Message[],
  phase: Extract<CompressionPhase, { type: 'summarize' }>,
): Promise<Message[]> {
  if (messages.length <= 1) return messages;
  if (!phase.summarizeFn) return messages;
  const summary = await phase.summarizeFn(messages);
  return [{ role: 'assistant', content: summary, source: 'distilled' }];
}

export function createSummarizeFn(
  getLLM: (model: string) => { invoke: (input: { messages: unknown[] }) => Promise<{ response: string; tokenUsage: unknown }> },
  model?: string,
): SummarizeFn {
  const defaultModel = model ?? 'default';
  const systemPrompt = `You are a conversation summarizer. Produce a structured summary with these sections:
- Goal / 目标
- Constraints / 约束
- Progress (Done / In Progress / Blocked)
- Key Decisions / 关键决策
- Next Steps / 后续步骤
- Critical Context / 关键上下文`;

  return async (messages: Message[]) => {
    const conversation = messages
      .map(m => `[${m.role}]: ${m.content}`)
      .join('\n');

    const llm = getLLM(defaultModel);
    try {
      const result = await llm.invoke({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Summarize this conversation:\n\n${conversation}` },
        ],
      });
      return result.response;
    } catch (error) {
      return `[Summary unavailable: ${error instanceof Error ? error.message : String(error)}]`;
    }
  };
}

export function createCompressionStrategy(config: CompressionConfig): CompressionStrategy {
  return async (messages: Message[], tc: TokenCounter, budget: number): Promise<Message[]> => {
    const totalTokens = tc.countMessages(messages);
    if (totalTokens <= budget) return messages;

    let compressed = [...messages];

    for (const phase of config.phases) {
      if (phase.type === 'truncate') {
        compressed = applyTruncate(compressed, tc, phase.maxTokens);
      } else if (phase.type === 'prune') {
        compressed = applyPrune(compressed, phase.keepRecent);
      } else if (phase.type === 'summarize') {
        if (!phase.summarizeFn) {
          console.warn('[CompressionStrategy] summarize phase configured without summarizeFn — skipping.');
        }
        compressed = await applySummarize(compressed, phase);
      }
    }

    return compressed;
  };
}
