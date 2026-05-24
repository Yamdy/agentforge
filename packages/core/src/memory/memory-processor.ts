import type { Processor, ProcessorContext } from '@primo-ai/sdk';
import type { MemorySystem } from './memory-system.js';
import { WorkingMemoryImpl } from './working-memory.js';

export function createMemoryRecallProcessor(system: MemorySystem): Processor {
  return {
    stage: 'buildContext',
    execute: async (pCtx: ProcessorContext) => {
      const ctx = pCtx.state;
      const userInput = ctx.session.input;
      const sessionId = ctx.session.sessionId;

      // Recall relevant memories
      const memories = await system.recall(userInput, {
        topK: 10,
      });

      // Inject Working Memory as prompt fragment
      const workingMemory = await system.getWorkingMemory(sessionId);
      if (workingMemory) {
        const wm = WorkingMemoryImpl.fromJSON(workingMemory);
        const injection = wm.toInjection('thread');
        ctx.agent.promptFragments = [
          ...ctx.agent.promptFragments,
          `<working_memory>\n${injection}\n</working_memory>`,
        ];
      }

      // Inject recalled memories as prompt fragments
      if (memories.length > 0) {
        const memoryBlock = memories
          .map((m) => `[Memory: ${m.type}] ${m.content}`)
          .join('\n');
        ctx.agent.promptFragments = [
          ...ctx.agent.promptFragments,
          `<recalled_memories>\n${memoryBlock}\n</recalled_memories>`,
        ];
      }
    },
  };
}

export function createMemoryStoreProcessor(system: MemorySystem): Processor {
  return {
    stage: 'processOutput',
    execute: async (pCtx: ProcessorContext) => {
      const ctx = pCtx.state;
      const sessionId = ctx.session.sessionId;
      const userInput = ctx.session.input?.trim();
      const response = ctx.iteration.response;

      if (!userInput && !response) return;

      if (userInput) {
        await system.remember(userInput, {
          type: 'event',
          scope: sessionId,
        });
      }

      if (response) {
        await system.remember(response, {
          type: 'event',
          scope: sessionId,
        });
      }
    },
  };
}
