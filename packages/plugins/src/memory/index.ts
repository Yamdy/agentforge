import type { HarnessAPI, PluginRegistration, Tool, ToolDefinition } from '@primo-ai/sdk';
import type { MemoryStorage } from '@primo-ai/core';
import { z } from 'zod';
import type { MemoryBackend } from './backend.js';
import { createMemoryProcessor, createMemoryOutputProcessor, type MemoryConfig, type MemoryTriggerMode } from './memory-processor.js';
import { CoreMemoryBackend } from './core-adapter.js';

export { InMemoryBackend } from './in-memory-backend.js';
export { SQLiteBackend } from './sqlite-backend.js';
export { CoreMemoryBackend } from './core-adapter.js';
export type { CoreMemoryBackendOptions } from './core-adapter.js';
export type { MemoryBackend, MemoryEntry } from './backend.js';
export type { MemoryConfig, MemoryTriggerMode } from './memory-processor.js';

export interface MemoryPluginOptions {
  backend?: MemoryBackend;
  storage?: MemoryStorage;
  triggerMode: MemoryTriggerMode;
  windowLimit?: number;
}

const MemoryPluginOptionsSchema = z.object({
  backend: z.unknown().optional(),
  storage: z.unknown().optional(),
  triggerMode: z.union([
    z.object({ type: z.literal('automatic'), onLoad: z.enum(['always', 'on-session-start']) }),
    z.object({ type: z.literal('agent-controlled') }),
    z.object({ type: z.literal('both') }),
  ]),
  windowLimit: z.number().int().positive().optional(),
});

export function memoryPlugin(options: MemoryPluginOptions): (api: HarnessAPI) => PluginRegistration {
  MemoryPluginOptionsSchema.parse(options);

  let backend: MemoryBackend;
  if (options.storage) {
    backend = new CoreMemoryBackend({ storage: options.storage });
    if (options.backend) {
      console.warn('memoryPlugin: storage takes precedence over backend, ignoring backend');
    }
  } else if (options.backend) {
    backend = options.backend;
  } else {
    throw new Error('memoryPlugin: either backend or storage must be provided');
  }

  const config: MemoryConfig = {
    backend,
    triggerMode: options.triggerMode,
    windowLimit: options.windowLimit,
  };

  const isAutomatic = config.triggerMode.type === 'automatic' || config.triggerMode.type === 'both';
  const isAgentControlled = config.triggerMode.type === 'agent-controlled' || config.triggerMode.type === 'both';

  return (api: HarnessAPI): PluginRegistration => {
    const processors = [];

    if (isAutomatic) {
      const buildProcessor = createMemoryProcessor(config);
      const outputProcessor = createMemoryOutputProcessor(config);
      api.registerProcessor('buildContext', buildProcessor);
      api.registerProcessor('processOutput', outputProcessor);
      processors.push(buildProcessor, outputProcessor);
    }

    if (isAgentControlled) {
      const retrieveTool: Tool<{ sessionId: string; query?: { limit?: number } }, unknown> = {
        name: 'retrieve_from_memory',
        description: 'Retrieve stored memory entries for a session',
        inputSchema: z.object({
          sessionId: z.string(),
          query: z.object({ limit: z.number().optional() }).optional(),
        }),
        execute: async ({ sessionId, query }) => {
          return config.backend.retrieve(sessionId, query);
        },
      };
      const recordTool: Tool<{ sessionId: string; role: string; content: string }, unknown> = {
        name: 'record_to_memory',
        description: 'Record a memory entry for a session',
        inputSchema: z.object({
          sessionId: z.string(),
          role: z.string(),
          content: z.string(),
        }),
        execute: async ({ sessionId, role, content }) => {
          await config.backend.store(sessionId, {
            role: role as 'user' | 'assistant' | 'system',
            content,
            timestamp: new Date().toISOString(),
          });
          return { stored: true };
        },
      };
      api.registerTool(retrieveTool as ToolDefinition);
      api.registerTool(recordTool as ToolDefinition);
    }

    return { processors };
  };
}
