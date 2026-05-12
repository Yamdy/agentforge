import type { Processor, PipelineContext, ProcessorResult, Span, Message } from '@agentforge/sdk';

export type { Message };

export type SummarizeFn = (messages: Message[]) => Promise<string>;

export type CompressionPhase =
  | { type: 'truncate'; maxLength: number }
  | { type: 'summarize'; model: string; maxTokens: number; summarizeFn?: SummarizeFn }
  | { type: 'prune'; keepRecent: number };

export interface CompressionConfig {
  maxContextTokens: number;
  phases: CompressionPhase[];
}

function estimateTokens(messages: Message[]): number {
  return messages.reduce((sum, m) => sum + Math.ceil(m.content.length / 4), 0);
}

function applyTruncate(messages: Message[], maxLength: number): Message[] {
  return messages.map((m) =>
    m.content.length > maxLength
      ? { ...m, content: m.content.slice(0, maxLength - 3) + '...' }
      : m,
  );
}

async function applySummarize(
  messages: Message[],
  phase: Extract<CompressionPhase, { type: 'summarize' }>,
): Promise<Message[]> {
  if (messages.length <= 1) return messages;

  const summarizeFn = phase.summarizeFn;
  if (!summarizeFn) return messages;

  const summary = await summarizeFn(messages);
  return [{ role: 'assistant', content: summary }];
}

export function createCompressionProcessor(config: CompressionConfig): Processor {
  return {
    stage: 'prepareStep',
    execute: async (ctx: PipelineContext): Promise<ProcessorResult> => {
      const history = ctx.session.messageHistory;
      if (!history || history.length === 0) return ctx;

      const tokensBefore = estimateTokens(history);
      if (tokensBefore <= config.maxContextTokens) return ctx;

      let compressed = [...history];
      let phasesApplied = 0;

      for (const phase of config.phases) {
        if (phase.type === 'truncate') {
          compressed = applyTruncate(compressed, phase.maxLength);
          phasesApplied++;
        } else if (phase.type === 'prune') {
          compressed = compressed.slice(-phase.keepRecent);
          phasesApplied++;
        } else if (phase.type === 'summarize') {
          compressed = await applySummarize(compressed, phase);
          phasesApplied++;
        }
      }

      const tokensAfter = estimateTokens(compressed);
      const span = ctx.iteration.span;
      if (span) {
        span
          .setAttribute('compression.triggered', true)
          .setAttribute('compression.phases_applied', phasesApplied)
          .setAttribute('compression.tokens_before', tokensBefore)
          .setAttribute('compression.tokens_after', tokensAfter);
      }

      return {
        ...ctx,
        session: { ...ctx.session, messageHistory: compressed },
      };
    },
  };
}
