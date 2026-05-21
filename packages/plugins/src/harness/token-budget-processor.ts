import { z } from 'zod';
import type { Processor, ProcessorContext, PipelineContext, TokenCounter, Message } from '@primo-ai/sdk';
import { SpanAttributeKeys, SpanType } from '@primo-ai/sdk';
import { HarnessDecisionRecorder } from '@primo-ai/core';

export interface TokenBudgetConfig {
  maxContextTokens: number;
  reservedOutputTokens: number;
  strategy: 'compress' | 'truncate' | 'block';
}

/** Rough heuristic: 4 chars per token. */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function estimateHistoryTokens(history: Message[], tokenCounter?: TokenCounter): number {
  if (tokenCounter) return tokenCounter.countMessages(history);
  let total = 0;
  for (const msg of history) {
    total += estimateTokens(msg.content);
    if (msg.role === 'assistant' && 'toolCalls' in msg && msg.toolCalls) {
      for (const tc of msg.toolCalls) total += estimateTokens(JSON.stringify(tc.args));
    }
  }
  return total;
}

/** Remove oldest messages until history fits within budget. Always keeps the last message. */
function truncateHistory(
  history: Message[],
  budget: number,
  tokenCounter?: TokenCounter,
): Message[] {
  if (history.length <= 1) return history;
  const result: Message[] = [...history];
  while (result.length > 1 && estimateHistoryTokens(result, tokenCounter) > budget) {
    result.shift();
  }
  return result;
}

const TokenBudgetConfigSchema = z.object({
  maxContextTokens: z.number().int().positive(),
  reservedOutputTokens: z.number().int().nonnegative(),
  strategy: z.enum(['compress', 'truncate', 'block']),
});

export function createTokenBudgetProcessor(
  config: TokenBudgetConfig,
  tokenCounter?: TokenCounter,
): Processor {
  TokenBudgetConfigSchema.parse(config);
  return {
    stage: 'gateLLM',
    priority: 90,
    execute: async (pCtx: ProcessorContext) => {
      const ctx = pCtx.state;
      const systemPromptTokens = estimateTokens(ctx.agent.systemPrompt ?? '');
      const toolDeclTokens = ctx.agent.toolDeclarations.reduce(
        (sum, t) => sum + estimateTokens(t.name + t.description), 0,
      );
      const reservedForSystem = systemPromptTokens + toolDeclTokens;
      const availableForHistory = config.maxContextTokens - config.reservedOutputTokens - reservedForSystem;

      const history = ctx.session.messageHistory ?? [];
      const historyTokens = estimateHistoryTokens(history, tokenCounter);
      const totalUsed = historyTokens + reservedForSystem;

      const childSpan = ctx.iteration.span?.startChild(SpanType.TOKEN_BUDGET_CHECK);
      childSpan?.setAttribute(SpanAttributeKeys.BUDGET_CONTEXT_MAX, config.maxContextTokens);
      childSpan?.setAttribute(SpanAttributeKeys.BUDGET_CONTEXT_USED, totalUsed);
      childSpan?.setAttribute(SpanAttributeKeys.BUDGET_RESERVED_OUTPUT, config.reservedOutputTokens);

      if (historyTokens <= availableForHistory) {
        childSpan?.setAttribute(SpanAttributeKeys.HARNESS_DECISION, 'allowed');
        childSpan?.end();
        return;
      }

      if (config.strategy === 'block') {
        childSpan?.setAttribute(SpanAttributeKeys.HARNESS_DECISION, 'blocked');
        childSpan?.setAttribute(SpanAttributeKeys.HARNESS_REASON, 'Token budget exceeded');
        childSpan?.end();
        HarnessDecisionRecorder.record(ctx, {
          processor: 'token-budget',
          stage: 'gateLLM',
          decision: 'block',
          reason: `Token budget exceeded: ${totalUsed} > ${config.maxContextTokens}`,
          timestamp: new Date().toISOString(),
        });
        pCtx.control.abort(`Token budget exceeded: ${totalUsed} tokens used, ${config.maxContextTokens} max`);
        return;
      }

      if (config.strategy === 'truncate') {
        const truncated = truncateHistory(history, availableForHistory, tokenCounter);
        childSpan?.setAttribute(SpanAttributeKeys.HARNESS_DECISION, 'allowed');
        childSpan?.setAttribute(SpanAttributeKeys.HARNESS_REASON, 'History truncated');
        childSpan?.end();
        ctx.session.messageHistory = truncated;
        return;
      }

      // strategy === 'compress': signal overrun, cooperative with ContextBuilder
      childSpan?.setAttribute(SpanAttributeKeys.HARNESS_DECISION, 'warned');
      childSpan?.setAttribute(SpanAttributeKeys.HARNESS_REASON, 'Token budget exceeded, flagged for compression');
      childSpan?.end();
      ctx.session.custom = { ...ctx.session.custom, tokenBudgetOverrun: true };
    },
  };
}
