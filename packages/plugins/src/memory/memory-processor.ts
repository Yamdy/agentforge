import type { Processor, ProcessorContext, PipelineContext } from '@primo-ai/sdk';
import { textContentFromBlocks } from '@primo-ai/core';
import type { MemoryBackend } from './backend.js';

export type MemoryTriggerMode =
  | { type: 'automatic'; onLoad: 'always' | 'on-session-start' }
  | { type: 'agent-controlled' }
  | { type: 'both' };

export type MemoryInjectionMode = 'history' | 'prompt' | 'both';

export interface MemoryAdmissionPolicy {
  dedup?: boolean;
  maxEntryLength?: number;
  correctionEnabled?: boolean;
  crossSessionCorrection?: boolean;
}

const CORRECTION_SIGNALS = /\b(actually|no\s*,?\s*wait|correction|sorry|I\s+meant|that's?\s+wrong|I\s+was\s+wrong)\b|不对|不是|错了|纠正|等等|違います|違う|訂正/i;

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
    execute: async (pCtx: ProcessorContext) => {
      const ctx = pCtx.state;
      if (triggerMode.type === 'agent-controlled') return;

      const entries = await backend.retrieve(ctx.session.sessionId, {
        limit: windowLimit,
      });

      if (entries.length === 0) return;

      if (injectionMode === 'history' || injectionMode === 'both') {
        const memoryMessages = entries.map((e) => ({
          role: e.role as 'user' | 'assistant',
          content: e.content,
        }));
        const existing = ctx.session.messageHistory ?? [];
        ctx.session.messageHistory = [...memoryMessages, ...existing];
      }

      if (injectionMode === 'prompt' || injectionMode === 'both') {
        const memoryBlock = entries
          .map((e) => `[${e.role}] ${e.content}`)
          .join('\n');
        ctx.agent.promptFragments = [...ctx.agent.promptFragments, `<memory>\n${memoryBlock}\n</memory>`];
      }
    },
  };
}

export function createMemoryOutputProcessor(config: MemoryConfig): Processor {
  const { backend, triggerMode } = config;
  const dedup = config.admissionPolicy?.dedup ?? true;
  const correctionEnabled = config.admissionPolicy?.correctionEnabled ?? false;
  const crossSessionCorrection = config.admissionPolicy?.crossSessionCorrection ?? false;
  const maxEntryLength = config.admissionPolicy?.maxEntryLength;

  const CUSTOM_KEY = '_memoryLastAssistant';

  const trim = (content: string): string => {
    if (maxEntryLength && content.length > maxEntryLength) {
      return content.slice(0, maxEntryLength) + '... [truncated]';
    }
    return content;
  };

  return {
    stage: 'processOutput',
    execute: async (pCtx: ProcessorContext) => {
      const ctx = pCtx.state;
      if (triggerMode.type === 'agent-controlled') return;

      const response = ctx.iteration.content
        ? textContentFromBlocks(ctx.iteration.content)
        : ctx.iteration.response;
      if (!response) return;

      const userInput = ctx.session.input?.trim();
      if (!userInput) return;

      const isCorrection = correctionEnabled && CORRECTION_SIGNALS.test(userInput);
      if (isCorrection) {
        if (crossSessionCorrection && backend.deleteEntriesGlobally) {
          await backend.deleteEntriesGlobally((e) => e.role === 'assistant');
        } else {
          await backend.deleteEntries(ctx.session.sessionId, (e) => e.role === 'assistant');
        }
      }

      const now = new Date().toISOString();
      await backend.store(ctx.session.sessionId, {
        role: 'user',
        content: trim(ctx.session.input),
        timestamp: now,
        ...(isCorrection ? { metadata: { corrected: true } } : {}),
      });

      // Read lastAssistantContent from session.custom (serialization-safe)
      const lastAssistantContent = ctx.session.custom?.[CUSTOM_KEY] as string | undefined;

      if (dedup && response === lastAssistantContent) {
        return;
      }

      // Persist to session.custom for suspend/resume survival
      ctx.session.custom = { ...ctx.session.custom, [CUSTOM_KEY]: response };

      await backend.store(ctx.session.sessionId, {
        role: 'assistant',
        content: trim(response),
        timestamp: new Date(Date.now() + 1).toISOString(),
      });
    },
  };
}
