/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument */
/**
 * AgentForge Compaction Manager
 *
 * Manages context window compaction for agent memory.
 * Integrates with agent loop to emit compaction events.
 *
 */

import { z } from 'zod';
import type { Message } from '../core/events.js';
import type { LLMAdapter } from '../core/interfaces.js';
import {
  type CompactionStrategy,
  type CompactionResult,
  estimateTokens,
  truncateOldest,
  summarize,
  importanceWeighted,
  CompactionStrategySchema,
  CompactionResultSchema,
} from './strategies.js';
import { HistoryOffloadManager } from './history-offload.js';

// ============================================================
// Compaction Configuration
// ============================================================

/**
 * Compaction configuration schema
 */
export const CompactionConfigSchema = z.object({
  /** Enable compaction */
  enabled: z.boolean().default(true),

  /** Trigger threshold (percentage of maxTokens, e.g., 0.8 = 80%) */
  triggerThreshold: z.number().min(0.5).max(0.95).default(0.8),

  /** Compaction strategy */
  strategy: CompactionStrategySchema.default('truncate-oldest'),

  /** Number of recent messages to preserve */
  preserveRecent: z.number().int().min(1).default(10),

  /** Maximum summary length (for summarize strategy) */
  maxSummaryLength: z.number().int().min(100).max(2000).default(500),

  /** Target token percentage after compaction (e.g., 0.5 = 50% of maxTokens) */
  targetTokenRatio: z.number().min(0.3).max(0.7).default(0.5),
});

export type CompactionConfig = z.infer<typeof CompactionConfigSchema>;

/**
 * Default compaction configuration
 */
export const DEFAULT_COMPACTION_CONFIG: CompactionConfig = {
  enabled: true,
  triggerThreshold: 0.8,
  strategy: 'truncate-oldest',
  preserveRecent: 10,
  maxSummaryLength: 500,
  targetTokenRatio: 0.5,
};

// ============================================================
// Compaction Context
// ============================================================

/**
 * Compaction context - input for compaction decisions
 */
export const CompactionContextSchema = z.object({
  /** Session ID */
  sessionId: z.string(),

  /** Current messages in conversation */
  messages: z.array(z.any()), // Message array

  /** Current token estimate */
  currentTokenEstimate: z.number(),

  /** Maximum tokens allowed (context window size) */
  maxTokens: z.number(),
});

export type CompactionContext = z.infer<typeof CompactionContextSchema>;

// ============================================================
// Compaction Manager
// ============================================================

/**
 * Compaction event emitted during compaction process
 */
export type CompactionEventPayload = {
  type: 'compaction.start' | 'compaction.complete';
  timestamp: number;
  sessionId: string;
  strategy: CompactionStrategy;
  tokensBefore?: number;
  tokensAfter?: number;
  removedMessages?: number;
  summarizedMessages?: number;
};

/**
 * Compaction Manager
 *
 * Manages context window compaction with configurable strategies.
 * Emits events for observability.
 */
export class CompactionManager {
  private config: CompactionConfig;
  private llmAdapter: LLMAdapter | undefined;
  private offloadManager: HistoryOffloadManager | undefined;
  private eventListeners: Array<(payload: CompactionEventPayload) => void> = [];

  /**
   * Create compaction manager
   *
   * @param config - Compaction configuration (partial, uses defaults)
   * @param llmAdapter - LLM adapter for summarize strategy (optional)
   * @param offloadManager - History offload manager for archiving removed messages (optional)
   */
  constructor(
    config: Partial<CompactionConfig> = {},
    llmAdapter?: LLMAdapter,
    offloadManager?: HistoryOffloadManager
  ) {
    this.config = CompactionConfigSchema.parse({
      ...DEFAULT_COMPACTION_CONFIG,
      ...config,
    });
    this.llmAdapter = llmAdapter;
    this.offloadManager = offloadManager;
  }

  /**
   * Get current configuration
   */
  getConfig(): CompactionConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(update: Partial<CompactionConfig>): void {
    this.config = CompactionConfigSchema.parse({
      ...this.config,
      ...update,
    });
  }

  /**
   * Set LLM adapter for summarize strategy
   */
  setLLMAdapter(adapter: LLMAdapter): void {
    this.llmAdapter = adapter;
  }

  /**
   * Subscribe to compaction events. Returns unsubscribe function.
   */
  on(handler: (payload: CompactionEventPayload) => void): () => void {
    this.eventListeners.push(handler);
    return () => {
      const idx = this.eventListeners.indexOf(handler);
      if (idx >= 0) this.eventListeners.splice(idx, 1);
    };
  }

  /**
   * Check if compaction is needed
   *
   * @param context - Compaction context with messages and token estimates
   * @returns true if compaction should be triggered
   */
  needsCompaction(context: CompactionContext): boolean {
    if (!this.config.enabled) {
      return false;
    }

    const thresholdTokens = this.config.triggerThreshold * context.maxTokens;
    return context.currentTokenEstimate >= thresholdTokens;
  }

  /**
   * Execute compaction
   *
   * @param context - Compaction context
   * @returns Compaction result with compacted messages
   */
  async compact(context: CompactionContext): Promise<CompactionResult> {
    // Emit compaction.start event
    this.emitStartEvent(context);

    let result: CompactionResult;

    switch (this.config.strategy) {
      case 'truncate-oldest':
        result = this.executeTruncateOldest(context);
        break;

      case 'summarize':
        result = await this.executeSummarize(context);
        break;

      case 'importance-weighted':
        result = this.executeImportanceWeighted(context);
        break;

      default:
        // Fallback to truncate-oldest for unknown strategies
        result = this.executeTruncateOldest(context);
    }

    // ── Offload removed messages for future retrieval ──
    if (this.offloadManager && result.removedCount > 0) {
      const resultMessages = result.messages as Message[];
      const removed = context.messages.filter((m: Message) => !resultMessages.includes(m));
      if (removed.length > 0) {
        try {
          await this.offloadManager.offload(context.sessionId, removed);
        } catch {
          // Offload failure is non-fatal — never crash the agent loop
        }
      }
    }

    // Validate result
    const validatedResult = CompactionResultSchema.parse(result);

    // Emit compaction.complete event
    this.emitCompleteEvent(context.sessionId, validatedResult);

    return validatedResult;
  }

  /**
   * Execute truncate-oldest strategy
   */
  private executeTruncateOldest(context: CompactionContext): CompactionResult {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    return truncateOldest(context.messages as Message[], this.config.preserveRecent);
  }

  /**
   * Execute summarize strategy
   */
  private async executeSummarize(context: CompactionContext): Promise<CompactionResult> {
    if (!this.llmAdapter) {
      // Fallback to truncate-oldest if no LLM adapter
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      return truncateOldest(context.messages as Message[], this.config.preserveRecent);
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    return summarize(
      context.messages as Message[],
      this.config.preserveRecent,
      this.llmAdapter,
      this.config.maxSummaryLength
    );
  }

  /**
   * Execute importance-weighted strategy
   */
  private executeImportanceWeighted(context: CompactionContext): CompactionResult {
    const targetTokens = Math.floor(context.maxTokens * this.config.targetTokenRatio);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    return importanceWeighted(
      context.messages as Message[],
      this.config.preserveRecent,
      targetTokens
    );
  }

  /**
   * Emit compaction.start event
   */
  private emitStartEvent(context: CompactionContext): void {
    for (const fn of this.eventListeners) {
      try {
        fn({
          type: 'compaction.start',
          timestamp: Date.now(),
          sessionId: context.sessionId,
          strategy: this.config.strategy,
          tokensBefore: context.currentTokenEstimate,
        });
      } catch {
        /* isolate */
      }
    }
  }

  /**
   * Emit compaction.complete event
   */
  private emitCompleteEvent(sessionId: string, result: CompactionResult): void {
    const eventPayload: CompactionEventPayload = {
      type: 'compaction.complete',
      timestamp: Date.now(),
      sessionId,
      strategy: result.strategy,
      tokensBefore: result.tokensBefore,
      tokensAfter: result.tokensAfter,
      removedMessages: result.removedCount,
    };
    if (result.summarizedCount !== undefined) {
      eventPayload.summarizedMessages = result.summarizedCount;
    }
    for (const fn of this.eventListeners) {
      try {
        fn(eventPayload);
      } catch {
        /* isolate */
      }
    }
  }

  /**
   * Create compaction context from messages
   *
   * Helper method for convenience
   */
  createContext(sessionId: string, messages: Message[], maxTokens: number): CompactionContext {
    return CompactionContextSchema.parse({
      sessionId,
      messages,
      currentTokenEstimate: estimateTokens(messages),
      maxTokens,
    });
  }

  /**
   * Quick compaction check and execution
   *
   * Combines needsCompaction and compact in one call.
   * Returns null if no compaction needed.
   */
  async compactIfNeeded(
    sessionId: string,
    messages: Message[],
    maxTokens: number
  ): Promise<CompactionResult | null> {
    const context = this.createContext(sessionId, messages, maxTokens);

    if (!this.needsCompaction(context)) {
      return null;
    }

    return this.compact(context);
  }
}

// ============================================================
// Factory Functions
// ============================================================

/**
 * Create compaction manager with default config
 */
export function createCompactionManager(
  llmAdapter?: LLMAdapter,
  offloadManager?: HistoryOffloadManager
): CompactionManager {
  return new CompactionManager({}, llmAdapter, offloadManager);
}

/**
 * Create compaction manager with truncate-oldest strategy
 */
export function createTruncateCompactionManager(
  preserveRecent: number = 10,
  offloadManager?: HistoryOffloadManager
): CompactionManager {
  return new CompactionManager(
    {
      strategy: 'truncate-oldest',
      preserveRecent,
    },
    undefined,
    offloadManager
  );
}

/**
 * Create compaction manager with summarize strategy
 */
export function createSummarizeCompactionManager(
  llmAdapter: LLMAdapter,
  preserveRecent: number = 10,
  maxSummaryLength: number = 500,
  offloadManager?: HistoryOffloadManager
): CompactionManager {
  return new CompactionManager(
    {
      strategy: 'summarize',
      preserveRecent,
      maxSummaryLength,
    },
    llmAdapter,
    offloadManager
  );
}

/**
 * Create disabled compaction manager (no compaction)
 */
export function createDisabledCompactionManager(): CompactionManager {
  return new CompactionManager({ enabled: false });
}
