import type { Processor } from '@agentforge/sdk';

export function createPrepareStepProcessor(): Processor {
  return {
    stage: 'prepareStep',
    execute: async (ctx) => {
      const maxHistory = 50;
      const history = ctx.session.messageHistory;
      const messageHistory = history && history.length > maxHistory
        ? history.slice(-maxHistory)
        : history;

      return {
        ...ctx,
        session: { ...ctx.session, messageHistory },
      };
    },
  };
}
