/**
 * Memory Plugin for AgentForge
 *
 * Intercepts agent.start to load AGENTS.md files,
 * intercepts llm.request to inject memory into messages.
 *
 * Uses existing InterceptorPlugin interface - zero new concepts.
 *
 * @module
 */

import { Observable, of, from } from 'rxjs';
import { map } from 'rxjs/operators';
import type { InterceptorPlugin, PluginContext } from '../plugins/plugin.js';
import type { AgentEvent, Message } from '../core/events.js';
import type { PersistentMemory } from '../memory/persistent.js';
import type { MemoryConfig, MemoryEntry } from '../memory/types.js';

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
 * @param config - Memory configuration
 * @returns InterceptorPlugin
 */
export function createMemoryPlugin(
  memory: PersistentMemory,
  config: MemoryConfig
): InterceptorPlugin {
  let entries: MemoryEntry[] = [];
  let loaded = false;

  return {
    name: 'memory',
    type: 'interceptor' as const,
    priority: 10,
    eventTypes: ['agent.start', 'llm.request'],
    enabled: config.enabled,

    intercept(event: AgentEvent, _ctx: PluginContext): Observable<AgentEvent> {
      if (event.type === 'agent.start' && !loaded) {
        // Load AGENTS.md files (IO operation, wrapped in from())
        return from(memory.load(config.sources)).pipe(
          map(result => {
            entries = result.entries;
            loaded = true;
            return event; // Don't modify agent.start event
          })
        );
      }

      if (event.type === 'llm.request' && loaded && entries.length > 0) {
        // Inject memory into messages
        const memoryText = memory.formatForPrompt(entries);
        const memoryMessage: Message = {
          role: 'system',
          content: memoryText,
          name: 'memory',
        };

        return of({
          ...event,
          messages: [memoryMessage, ...event.messages],
        });
      }

      return of(event);
    },
  };
}
