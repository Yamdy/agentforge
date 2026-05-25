import type { Processor, ProcessorContext, PipelineContext } from '@primo-ai/sdk';
import type { ContextBuilder } from '../context-builder.js';
import type { EventBus } from '../event-bus.js';

export interface CompressContextDeps {
  contextBuilder: ContextBuilder;
  eventBus?: EventBus;
}

/**
 * Creates a processor that runs in the agentic loop to compress message history
 * when it exceeds the context budget. This fixes F-8: ContextBuilder.trimHistory()
 * only ran pre-loop, causing unbounded history growth during long-running agents.
 *
 * Also acts on the `tokenBudgetOverrun` flag set by TokenBudgetProcessor's
 * `compress` strategy, forcing compression even when the normal budget check passes.
 */
export function createCompressContextProcessor(
  contextBuilder: ContextBuilder,
  eventBus?: EventBus,
): Processor {
  return {
    stage: 'compressContext',
    execute: async (pCtx: ProcessorContext) => {
      const ctx = pCtx.state;
      const history = ctx.session.messageHistory;
      if (!history || history.length === 0) return;

      const beforeCount = history.length;

      // Check for tokenBudgetOverrun flag from TokenBudgetProcessor
      const forceCompress = ctx.session.custom?.tokenBudgetOverrun === true;

      const result = await contextBuilder.compressIfNeeded(ctx);

      // Clear the overrun flag after acting on it
      if (forceCompress) {
        result.session.custom = { ...result.session.custom, tokenBudgetOverrun: false };
      }

      const afterCount = result.session.messageHistory?.length ?? 0;
      const didCompress = afterCount < beforeCount;

      // Also compress if forceCompress flag was set but compressIfNeeded didn't
      // reduce count (budget is high but TokenBudgetProcessor detected overrun
      // with its own heuristic). Apply sliding window as fallback.
      if (forceCompress && !didCompress && history.length > 10) {
        const compressed = history.slice(-10);
        result.session.messageHistory = compressed;
        const finalCount = compressed.length;
        eventBus?.emit('context:compressed', {
          step: ctx.iteration.step,
          beforeCount,
          afterCount: finalCount,
          forced: true,
        });
        // Update pCtx.state
        Object.assign(pCtx.state, result);
        return;
      }

      if (didCompress) {
        eventBus?.emit('context:compressed', {
          step: ctx.iteration.step,
          beforeCount,
          afterCount,
          forced: forceCompress,
        });
      }

      // Update pCtx.state with compressed context
      Object.assign(pCtx.state, result);
    },
  };
}
