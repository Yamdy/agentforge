/**
 * Summarization Plugin for AgentForge
 *
 * Intercepts llm.request to check token threshold.
 * If over threshold, compresses messages and offloads old ones.
 *
 * Uses existing CompactionManager strategies + HistoryOffloadManager.
 *
 * @module
 */

import { Observable, of, defer } from 'rxjs';
import type { InterceptorPlugin, PluginContext } from '../plugins/plugin.js';
import type { AgentEvent } from '../core/events.js';
import { estimateTokens, truncateOldest } from '../memory/strategies.js';
import { HistoryOffloadManager } from '../memory/history-offload.js';

/**
 * Summarization Plugin configuration
 */
export interface SummarizationPluginConfig {
  /** Token threshold to trigger compression (e.g., 100000) */
  tokenThreshold: number;

  /** Number of recent messages to preserve during compression */
  preserveRecent: number;

  /** Directory for offloaded history files */
  offloadDir?: string;

  /** Whether the plugin is enabled */
  enabled?: boolean;
}

/**
 * Create a Summarization Plugin
 *
 * Intercepts llm.request events and checks token count.
 * If over threshold, truncates oldest messages and offloads them.
 *
 * Priority: 20 (after Skills at 5 and Memory at 10)
 *
 * @param config - Summarization configuration
 * @returns InterceptorPlugin
 */
export function createSummarizationPlugin(config: SummarizationPluginConfig): InterceptorPlugin {
  const offloadManager = config.offloadDir
    ? new HistoryOffloadManager({ historyDir: config.offloadDir })
    : null;

  return {
    name: 'summarization',
    type: 'interceptor' as const,
    priority: 20,
    eventTypes: ['llm.request'],
    enabled: config.enabled ?? true,

    intercept(event: AgentEvent, _ctx: PluginContext): Observable<AgentEvent> {
      if (event.type !== 'llm.request') return of(event);

      const tokens = estimateTokens(event.messages);

      // Below threshold, no compression needed
      if (tokens < config.tokenThreshold) return of(event);

      // Compress: truncate oldest messages
      const result = truncateOldest(event.messages, config.preserveRecent);

      if (result.removedCount === 0) return of(event);

      // Offload removed messages (async, wrapped in defer)
      if (offloadManager) {
        const removed = event.messages.slice(0, result.removedCount);
        return defer(async () => {
          await offloadManager.offload(event.sessionId, removed);
          return { ...event, messages: result.messages };
        });
      }

      // No offload manager, just compress
      return of({ ...event, messages: result.messages });
    },
  };
}
