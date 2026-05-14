import type { Processor, PipelineContext, ProcessorResult } from '@agentforge/sdk';
import type { MemoryBackend } from './backend.js';

export type MemoryTriggerMode =
  | { type: 'automatic'; onLoad: 'always' | 'on-session-start' }
  | { type: 'agent-controlled' }
  | { type: 'both' };

export type MemoryInjectionMode = 'history' | 'prompt' | 'both';

export interface MemoryAdmissionPolicy {
  dedup?: boolean;
  maxEntryLength?: number;
}

export interface MemoryConfig {
  backend: MemoryBackend;
  triggerMode: MemoryTriggerMode;
  windowLimit?: number;
  injectionMode?: MemoryInjectionMode;
  admissionPolicy?: MemoryAdmissionPolicy;
}

export function createMemoryProcessor(config: MemoryConfig): Processor {
  const { backend, triggerMode, windowLimit } = config;
  const injectionMode = config.injectionMode ?? 'history';

  return {
    stage: 'buildContext',
    execute: async (ctx: PipelineContext): Promise<ProcessorResult> => {
      if (triggerMode.type === 'agent-controlled') return ctx;

      const entries = await backend.retrieve(ctx.request.sessionId, {
        limit: windowLimit,
      });

      if (entries.length === 0) return ctx;

      const updates: Partial<Pick<PipelineContext, 'session' | 'agent'>> = {};

      if (injectionMode === 'history' || injectionMode === 'both') {
        const memoryMessages = entries.map((e) => ({
          role: e.role as 'user' | 'assistant',
          content: e.content,
        }));
        const existing = ctx.session.messageHistory ?? [];
        updates.session = {
          ...ctx.session,
          messageHistory: [...memoryMessages, ...existing],
        };
      }

      if (injectionMode === 'prompt' || injectionMode === 'both') {
        const memoryBlock = entries
          .map((e) => `[${e.role}] ${e.content}`)
          .join('\n');
        updates.agent = {
          ...ctx.agent,
          promptFragments: [...ctx.agent.promptFragments, `<memory>\n${memoryBlock}\n</memory>`],
        };
      }

      return { ...ctx, ...updates };
    },
  };
}

export function createMemoryOutputProcessor(config: MemoryConfig): Processor {
  const { backend, triggerMode } = config;
  const dedup = config.admissionPolicy?.dedup ?? true;
  const maxEntryLength = config.admissionPolicy?.maxEntryLength;
  let lastAssistantContent: string | undefined;

  const trim = (content: string): string => {
    if (maxEntryLength && content.length > maxEntryLength) {
      return content.slice(0, maxEntryLength) + '... [truncated]';
    }
    return content;
  };

  return {
    stage: 'processOutput',
    execute: async (ctx: PipelineContext): Promise<ProcessorResult> => {
      if (triggerMode.type === 'agent-controlled') return ctx;

      const response = ctx.iteration.response;
      if (!response) return ctx;

      const now = new Date().toISOString();
      await backend.store(ctx.request.sessionId, {
        role: 'user',
        content: trim(ctx.request.input),
        timestamp: now,
      });

      if (dedup && response === lastAssistantContent) {
        return ctx;
      }
      lastAssistantContent = response;

      await backend.store(ctx.request.sessionId, {
        role: 'assistant',
        content: trim(response),
        timestamp: new Date(Date.now() + 1).toISOString(),
      });

      return ctx;
    },
  };
}
