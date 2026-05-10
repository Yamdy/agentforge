import type { HarnessAPI, PluginRegistration, Tool } from '@agentforge/sdk';
import { z } from 'zod';
import type { MemoryBackend } from './backend.js';
import { createMemoryProcessor, createMemoryOutputProcessor, type MemoryConfig, type MemoryTriggerMode } from './memory-processor.js';

export { InMemoryBackend } from './in-memory-backend.js';
export type { MemoryBackend, MemoryEntry } from './backend.js';
export type { MemoryConfig, MemoryTriggerMode } from './memory-processor.js';

export interface MemoryPluginOptions {
  backend: MemoryBackend;
  triggerMode: MemoryTriggerMode;
  windowLimit?: number;
}

export function memoryPlugin(options: MemoryPluginOptions): (api: HarnessAPI) => PluginRegistration {
  const config: MemoryConfig = {
    backend: options.backend,
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
      api.registerTool(retrieveTool);
      api.registerTool(recordTool);
    }

    return { processors };
  };
}
