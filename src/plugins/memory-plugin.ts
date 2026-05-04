/**
 * Memory Plugin for AgentForge
 *
 * Loads AGENTS.md files on session.start and injects memory
 * into messages before each LLM request.
 *
 * Supports two modes:
 * - **autoDiscover**: Walks up from cwd to root, collecting AGENTS.md files
 * - **Default**: Uses configured sources via memory.load()
 *
 * @module
 */

import type { Plugin } from '../plugins/plugin.js';
import type { Message } from '../core/events.js';
import type { PersistentMemory } from '../memory/persistent.js';
import type { MemoryConfig, MemoryEntry } from '../memory/types.js';
import { loadAgentsMd } from '../memory/agents-md.js';
import { RequestHookPriority } from '../core/hooks.js';

/**
 * Extended MemoryConfig with auto-discovery options.
 */
export interface MemoryPluginConfig extends MemoryConfig {
  /** Enable auto-discovery of AGENTS.md files (walks up from cwd) */
  autoDiscover?: boolean;

  /** Starting directory for auto-discovery (default: process.cwd()) */
  cwd?: string;
}

/**
 * Create a Memory Plugin
 *
 * Hooks:
 * - session.start: Loads AGENTS.md files into cache
 * - requestHooks: Prepends memory content to messages before each LLM call
 *
 * Priority: MEMORY_CONTEXT (20)
 *
 * @param memory - PersistentMemory implementation
 * @param config - Memory configuration (supports autoDiscover option)
 * @returns Plugin
 */
export function createMemoryPlugin(memory: PersistentMemory, config: MemoryPluginConfig): Plugin {
  let entries: MemoryEntry[] = [];
  let loaded = false;

  return {
    name: 'memory',
    enabled: config.enabled,

    lifecycleHooks: [
      {
        name: 'session.start',
        fn: async () => {
          if (loaded) return;

          if (config.autoDiscover) {
            const result = await loadAgentsMd(config.cwd ? { cwd: config.cwd } : {});
            if (result.content) {
              entries = [
                {
                  id: 'agents-md-auto',
                  content: result.content,
                  sourcePath: result.paths.join(', '),
                  createdAt: Date.now(),
                  updatedAt: Date.now(),
                },
              ];
            }
            loaded = true;
          } else {
            const result = await memory.load(config.sources);
            entries = result.entries;
            loaded = true;
          }
        },
      },
    ],

    requestHooks: [
      {
        name: 'memory-context',
        priority: RequestHookPriority.MEMORY_CONTEXT,
        apply(messages: Message[]): Message[] {
          if (loaded && entries.length > 0) {
            const memoryText = memory.formatForPrompt(entries);
            const memoryMessage: Message = { role: 'system', content: memoryText, name: 'memory' };
            return [memoryMessage, ...messages];
          }
          return messages;
        },
      },
    ],
  };
}
