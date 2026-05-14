import type { CompressionStrategy, Message, Processor, SlidingWindowOptions } from '@agentforge/sdk';

/**
 * Built-in strategy: keep only the N most recent messages.
 * This is the exact behavior that was previously hard-coded in prepare-step.
 */
export function slidingWindowStrategy(options?: SlidingWindowOptions): CompressionStrategy {
  const keepRecent = options?.keepRecent ?? 50;
  if (keepRecent <= 0) {
    throw new RangeError(`slidingWindowStrategy: keepRecent must be > 0, got ${options?.keepRecent}`);
  }
  return (messages: Message[]): Message[] => {
    return messages.length > keepRecent
      ? messages.slice(-keepRecent)
      : messages;
  };
}

/**
 * Creates the prepareStep processor.
 * If no strategy is provided, uses slidingWindowStrategy({ keepRecent: 50 }).
 */
export function createPrepareStepProcessor(strategy?: CompressionStrategy): Processor {
  const resolve = strategy ?? slidingWindowStrategy();

  return {
    stage: 'prepareStep',
    execute: async (ctx) => {
      const history = ctx.session.messageHistory;
      if (!history || history.length === 0) {
        return ctx;
      }

      const messageHistory = await resolve(history);

      return {
        ...ctx,
        session: { ...ctx.session, messageHistory },
      };
    },
  };
}
