/**
 * Memory Plugin for AgentForge
 *
 * Intercepts agent.start to load AGENTS.md files,
 * intercepts llm.request to inject memory into messages.
 *
 * Uses existing InterceptorPlugin interface - zero new concepts.
 *
 * Supports two modes:
 * - **autoDiscover**: Walks up from cwd to root, collecting AGENTS.md files
 * - **Default**: Uses configured sources via memory.load()
 *
 * @module
 */

import type { InterceptorPlugin, PluginContext } from '../plugins/plugin.js';
import type { AgentEvent, Message } from '../core/events.js';
import type { PersistentMemory } from '../memory/persistent.js';
import type { MemoryConfig, MemoryEntry } from '../memory/types.js';
import { loadAgentsMd } from '../memory/agents-md.js';

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
 * Intercepts:
 * - agent.start: Loads AGENTS.md files into cache
 * - llm.request: Prepends memory content to messages
 *
 * Priority: 10 (after Skills at 5, so Memory appears first in final messages)
 *
 * @param memory - PersistentMemory implementation
 * @param config - Memory configuration (supports autoDiscover option)
 * @returns InterceptorPlugin
 */
export function createMemoryPlugin(
  memory: PersistentMemory,
  config: MemoryPluginConfig
): InterceptorPlugin {
  let entries: MemoryEntry[] = [];
  let loaded = false;

  return {
    name: 'memory',
    type: 'interceptor' as const,
    priority: 10,
    eventTypes: ['agent.start', 'llm.request'],
    enabled: config.enabled,

    intercept(event: AgentEvent, _ctx: PluginContext): any {
      if (event.type === 'agent.start' && !loaded) {
        if (config.autoDiscover) {
          return loadAgentsMd(config.cwd ? { cwd: config.cwd } : {}).then(result => {
            if (result.content) {
              entries = [{
                id: 'agents-md-auto',
                content: result.content,
                sourcePath: result.paths.join(', '),
                createdAt: Date.now(),
                updatedAt: Date.now(),
              }];
            }
            loaded = true;
            return event;
          });
        }
        return memory.load(config.sources).then(result => {
          entries = result.entries;
          loaded = true;
          return event;
        });
      }
      if (event.type === 'llm.request' && loaded && entries.length > 0) {
        const memoryText = memory.formatForPrompt(entries);
        const memoryMessage: Message = { role: 'system', content: memoryText, name: 'memory' };
        return { ...event, messages: [memoryMessage, ...event.messages] };
      }
      return event;
    },
  };
}
