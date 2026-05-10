import type { Processor, PipelineContext, ProcessorResult } from '@agentforge/sdk';
import type { MemoryBackend } from './backend.js';

export type MemoryTriggerMode =
  | { type: 'automatic'; onLoad: 'always' | 'on-session-start' }
  | { type: 'agent-controlled' }
  | { type: 'both' };

export interface MemoryConfig {
  backend: MemoryBackend;
  triggerMode: MemoryTriggerMode;
  windowLimit?: number;
}

export function createMemoryProcessor(config: MemoryConfig): Processor {
  const { backend, triggerMode, windowLimit } = config;

  return {
    stage: 'buildContext',
    execute: async (ctx: PipelineContext): Promise<ProcessorResult> => {
      if (triggerMode.type === 'agent-controlled') return ctx;

      const entries = await backend.retrieve(ctx.request.sessionId, {
        limit: windowLimit,
      });

      if (entries.length === 0) return ctx;

      const messageHistory = entries.map((e) => ({
        role: e.role,
        content: e.content,
      }));

      const memoryBlock = entries
        .map((e) => `[${e.role}] ${e.content}`)
        .join('\n');
      const promptFragments = [`<memory>\n${memoryBlock}\n</memory>`];

      return {
        ...ctx,
        session: { ...ctx.session, messageHistory },
        pipeline: { ...ctx.pipeline, promptFragments },
      };
    },
  };
}

export function createMemoryOutputProcessor(config: MemoryConfig): Processor {
  const { backend, triggerMode } = config;

  return {
    stage: 'processOutput',
    execute: async (ctx: PipelineContext): Promise<ProcessorResult> => {
      if (triggerMode.type === 'agent-controlled') return ctx;

      const response = ctx.pipeline.response as string | undefined;
      if (!response) return ctx;

      const now = new Date().toISOString();
      await backend.store(ctx.request.sessionId, {
        role: 'user',
        content: ctx.request.input,
        timestamp: now,
      });
      await backend.store(ctx.request.sessionId, {
        role: 'assistant',
        content: response,
        timestamp: new Date(Date.now() + 1).toISOString(),
      });

      return ctx;
    },
  };
}
