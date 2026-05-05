/**
 * Summarization Plugin for AgentForge
 *
 * Checks token threshold before each LLM request.
 * If over threshold, compresses messages and offloads old ones.
 *
 * Uses existing CompactionManager strategies + HistoryOffloadManager.
 *
 * @module
 */

import type { Plugin } from '../plugins/plugin.js';
import type { Message } from '../core/events.js';
import type { AgentState } from '../core/state.js';
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
 * Hooks into llm.request to check token count.
 * If over threshold, truncates oldest messages and offloads them.
 *
 * Priority: 20 (after Memory at 20 and Skills at 30 — runs between them)
 *
 * @param config - Summarization configuration
 * @returns Plugin
 */
export function createSummarizationPlugin(config: SummarizationPluginConfig): Plugin {
  const offloadManager = config.offloadDir
    ? new HistoryOffloadManager({ historyDir: config.offloadDir })
    : null;

  return {
    name: 'summarization',
    enabled: config.enabled ?? true,

    requestHooks: [
      {
        name: 'summarization-compact',
        priority: 20,
        async apply(messages: Message[], state: AgentState): Promise<Message[]> {
          const tokens = estimateTokens(messages);
          if (!shouldCompact(tokens, config)) return messages;

          const result = truncateOldest(messages, config.preserveRecent);
          if (result.removedCount === 0) return messages;

          if (offloadManager) {
            const removed = messages.slice(0, result.removedCount);
            await offloadManager.offload(state.sessionId, removed);
          }

          return result.messages;
        },
      },
    ],
  };
}
