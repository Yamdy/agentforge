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

import type { InterceptorPlugin, PluginContext } from '../plugins/plugin.js';
import type { AgentEvent } from '../core/events.js';
import { estimateTokens, truncateOldest } from '../memory/strategies.js';
import { HistoryOffloadManager } from '../memory/history-offload.js';

// ============================================================
// Threshold Logic
// ============================================================

/**
 * Determine whether compression should be triggered based on config.
 *
 * Supports two modes:
 * 1. Percentage mode: triggerThreshold (0-1) × maxTokens → absolute threshold
 * 2. Absolute mode: tokenThreshold directly as token count
 *
 * Percentage mode takes priority when both are set.
 */
function shouldCompact(tokens: number, config: SummarizationPluginConfig): boolean {
  if (config.triggerThreshold !== undefined && config.maxTokens !== undefined) {
    // Percentage mode: e.g., 0.85 × 128000 = 108800 tokens
    return tokens > config.maxTokens * config.triggerThreshold;
  }

  if (config.tokenThreshold !== undefined) {
    // Absolute mode (backward compatible)
    return tokens > config.tokenThreshold;
  }

  // No threshold configured — never compact
  return false;
}

/**
 * Summarization Plugin configuration
 */
export interface SummarizationPluginConfig {
  /** Token threshold to trigger compression (absolute token count, e.g., 100000) */
  tokenThreshold?: number;

  /** Percentage threshold to trigger compression (0-1, e.g., 0.85 = 85% of maxTokens).
   * When set with maxTokens, takes priority over tokenThreshold. */
  triggerThreshold?: number;

  /** Model max token count for percentage-based threshold calculation.
   * Required when using triggerThreshold. E.g., 128000 for GPT-4o. */
  maxTokens?: number;

  /** Number of recent messages to preserve during compression */
  preserveRecent: number;

  /** Directory for offloaded history files */
  offloadDir?: string;

  /** Compression strategy to use (default: 'truncate-oldest') */
  strategy?: 'truncate-oldest' | 'summarize' | 'importance-weighted';

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

    intercept(event: AgentEvent, _ctx: PluginContext): any {
      if (event.type !== 'llm.request') return event;
      const tokens = estimateTokens(event.messages);
      if (!shouldCompact(tokens, config)) return event;
      const result = truncateOldest(event.messages, config.preserveRecent);
      if (result.removedCount === 0) return event;
      if (offloadManager) {
        const removed = event.messages.slice(0, result.removedCount);
        return offloadManager.offload(event.sessionId, removed).then(() => ({ ...event, messages: result.messages }));
      }
      return { ...event, messages: result.messages };
    },
  };
}
