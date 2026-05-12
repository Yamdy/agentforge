import type { Processor } from '@agentforge/sdk';
import type { ToolRegistry } from '../tool-registry.js';

export function createPrepareStepProcessor(registry: ToolRegistry): Processor {
  return {
    stage: 'prepareStep',
    execute: async (ctx) => {
      const maxHistory = 50;
      const history = ctx.session.messageHistory;
      const messageHistory = history && history.length > maxHistory
        ? history.slice(-maxHistory)
        : history;

      const toolDeclarations = registry.getAll().map(t => ({
        name: t.name,
        description: t.description,
      }));

      return {
        ...ctx,
        session: { ...ctx.session, messageHistory },
        agent: { ...ctx.agent, toolDeclarations },
      };
    },
  };
}
