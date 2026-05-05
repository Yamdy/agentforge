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
  snipCompaction,
  pointerIndexed,
  microcompact,
  type PointerIndexedConfig,
  CompactionStrategySchema,
  CompactionResultSchema,
} from './strategies.js';
import { HistoryOffloadManager } from './history-offload.js';
import type { VectorStore } from './vector-store.js';
import type { EmbeddingModel } from './embedding.js';
import { type WorkingMemory, WorkingMemoryProcessor } from './working-memory.js';

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

  /** Number of recent turns to preserve (for snip strategy) */
  keepRecentTurns: z.number().int().min(1).default(3),
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
  keepRecentTurns: 3,
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
// Message Validation
// ============================================================

/**
 * Filter out messages that don't have at least a {role: string} shape.
 * Prevents crashes when corrupted data ends up in the messages array.
 * This is a Tier-1 defensive check: safeParse + graceful degradation.
 */
function filterValidMessages(messages: unknown[]): Message[] {
  return messages.filter(
    (m): m is Message =>
      typeof m === 'object' &&
      m !== null &&
      'role' in m &&
      typeof (m as Record<string, unknown>).role === 'string'
  );
}

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
  private vectorStore: VectorStore | undefined;
  private embeddingModel: EmbeddingModel | undefined;
  private workingMemoryProcessor: WorkingMemoryProcessor | undefined;
  private workingMemory: WorkingMemory | undefined;
  private compactionCounter = 0;
  private eventListeners: Array<(payload: CompactionEventPayload) => void> = [];

  /**
   * Create compaction manager
   *
   * @param config - Compaction configuration (partial, uses defaults)
   * @param llmAdapter - LLM adapter for summarize strategy (optional)
   * @param offloadManager - History offload manager for archiving removed messages (optional)
   * @param vectorStore - Vector store for pointer-indexed strategy (optional)
   * @param embeddingModel - Embedding model for pointer-indexed strategy (optional)
   */
  constructor(
    config: Partial<CompactionConfig> = {},
    llmAdapter?: LLMAdapter,
    offloadManager?: HistoryOffloadManager,
    vectorStore?: VectorStore,
    embeddingModel?: EmbeddingModel
  ) {
    this.config = CompactionConfigSchema.parse({
      ...DEFAULT_COMPACTION_CONFIG,
      ...config,
    });
    this.llmAdapter = llmAdapter;
    this.offloadManager = offloadManager;
    this.vectorStore = vectorStore;
    this.embeddingModel = embeddingModel;
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
   * Set working memory processor and memory reference.
   *
   * When configured, the compaction manager will preserve pinned working memory
   * content before removing messages. Pinned items are extracted from the
   * conversation and stored in the WorkingMemory object so the RequestHook
   * can re-inject them after compaction.
   *
   * @param processor - WorkingMemoryProcessor instance
   * @param memory    - WorkingMemory data reference (shared with tools/hooks)
   */
  setWorkingMemory(processor: WorkingMemoryProcessor, memory: WorkingMemory): void {
    this.workingMemoryProcessor = processor;
    this.workingMemory = memory;
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
   * @param options - Optional aggressive mode flag
   * @returns true if compaction should be triggered
   */
  needsCompaction(context: CompactionContext, options?: { aggressive?: boolean }): boolean {
    if (!this.config.enabled) {
      return false;
    }

    const effectiveThreshold = options?.aggressive
      ? this.config.triggerThreshold * 0.7
      : this.config.triggerThreshold;

    const thresholdTokens = effectiveThreshold * context.maxTokens;
    return context.currentTokenEstimate >= thresholdTokens;
  }

  /**
   * Execute compaction
   *
   * @param context - Compaction context
   * @param options - Optional aggressive mode flag
   * @returns Compaction result with compacted messages
   */
  async compact(
    context: CompactionContext,
    options?: { aggressive?: boolean }
  ): Promise<CompactionResult> {
    // Emit compaction.start event
    this.emitStartEvent(context);

    // ── Validate message shapes (Finding #8) ──
    // Filter out non-Message objects to prevent strategy crashes from corrupted data.
    const validMessages = filterValidMessages(context.messages as unknown[]);
    if (validMessages.length === 0) {
      const emptyResult: CompactionResult = {
        messages: [],
        removedCount: context.messages.length,
        tokensBefore: context.currentTokenEstimate,
        tokensAfter: 0,
        strategy: this.config.strategy,
      };
      this.emitCompleteEvent(context.sessionId, emptyResult);
      return emptyResult;
    }
    if (validMessages.length < context.messages.length) {
      context.messages = validMessages;
    }

    // ── Working Memory: preserve pinned content before compaction ──
    if (this.workingMemoryProcessor && this.workingMemory) {
      // Extract pinned metadata from current messages before they are removed.
      // Pinned items are stored in the WorkingMemory object and will be
      // re-injected by the RequestHook after compaction.
      this.workingMemoryProcessor.process(context.messages as Message[], this.workingMemory);
    }

    let result: CompactionResult;

    switch (this.config.strategy) {
      case 'truncate-oldest':
        result = this.executeTruncateOldest(context, options);
        break;

      case 'summarize':
        result = await this.executeSummarize(context, options);
        break;

      case 'importance-weighted':
        result = this.executeImportanceWeighted(context, options);
        break;

      case 'snip':
        result = this.executeSnip(context, options);
        break;

      case 'pointer-indexed':
        result = await this.executePointerIndexed(context, options);
        break;

      case 'microcompact':
        result = this.executeMicrocompact(context, options);
        break;

      default:
        // Fallback to truncate-oldest for unknown strategies
        result = this.executeTruncateOldest(context);
    }

    // ── Offload removed messages for future retrieval ──
    if (this.offloadManager && result.removedCount > 0) {
      const resultMessages = result.messages as Message[];
      // Track which original indices were kept (by reference comparison).
      // Using indices avoids the fragile === reference equality of .includes().
      const keptIndices = new Set<number>();
      for (let i = 0; i < context.messages.length; i++) {
        if (resultMessages.some(rm => rm === context.messages[i])) {
          keptIndices.add(i);
        }
      }
      // Offload messages whose indices are NOT in the kept set
      const removed = context.messages.filter((_, idx) => !keptIndices.has(idx));
      if (removed.length > 0) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
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
  private executeTruncateOldest(
    context: CompactionContext,
    options?: { aggressive?: boolean }
  ): CompactionResult {
    const preserveRecent = options?.aggressive
      ? Math.max(2, Math.floor(this.config.preserveRecent / 2))
      : this.config.preserveRecent;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    return truncateOldest(context.messages as Message[], preserveRecent);
  }

  /**
   * Execute summarize strategy
   */
  private async executeSummarize(
    context: CompactionContext,
    options?: { aggressive?: boolean }
  ): Promise<CompactionResult> {
    const preserveRecent = options?.aggressive
      ? Math.max(2, Math.floor(this.config.preserveRecent / 2))
      : this.config.preserveRecent;
    const maxSummaryLength = options?.aggressive
      ? Math.floor(this.config.maxSummaryLength / 2)
      : this.config.maxSummaryLength;

    if (!this.llmAdapter) {
      // Fallback to truncate-oldest if no LLM adapter
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      return truncateOldest(context.messages as Message[], preserveRecent);
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    return summarize(
      context.messages as Message[],
      preserveRecent,
      this.llmAdapter,
      maxSummaryLength
    );
  }

  /**
   * Execute importance-weighted strategy
   */
  private executeImportanceWeighted(
    context: CompactionContext,
    options?: { aggressive?: boolean }
  ): CompactionResult {
    const targetTokenRatio = options?.aggressive
      ? this.config.targetTokenRatio * 0.8
      : this.config.targetTokenRatio;
    const targetTokens = Math.floor(context.maxTokens * targetTokenRatio);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    return importanceWeighted(
      context.messages as Message[],
      this.config.preserveRecent,
      targetTokens
    );
  }

  /**
   * Execute snip strategy
   */
  private executeSnip(
    context: CompactionContext,
    options?: { aggressive?: boolean }
  ): CompactionResult {
    const keepRecentTurns = options?.aggressive
      ? Math.max(1, Math.floor(this.config.keepRecentTurns / 2))
      : this.config.keepRecentTurns;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    return snipCompaction(context.messages as Message[], keepRecentTurns);
  }

  /**
   * Execute pointer-indexed strategy
   *
   * Indexes removed messages into VectorStore and replaces them
   * with a lightweight pointer message in context.
   * Falls back to truncate-oldest if VectorStore is unavailable.
   */
  private async executePointerIndexed(
    context: CompactionContext,
    options?: { aggressive?: boolean }
  ): Promise<CompactionResult> {
    const preserveRecent = options?.aggressive
      ? Math.max(2, Math.floor(this.config.preserveRecent / 2))
      : this.config.preserveRecent;

    if (!this.vectorStore || !this.embeddingModel) {
      // Fallback to truncate-oldest if no VectorStore/EmbeddingModel available
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      return truncateOldest(context.messages as Message[], preserveRecent);
    }

    const pointerConfig: PointerIndexedConfig = {
      preserveRecent,
      sessionId: context.sessionId,
      compactionIndex: this.compactionCounter++,
    };

    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    return pointerIndexed(
      context.messages as Message[],
      pointerConfig,
      this.vectorStore,
      this.embeddingModel
    );
  }

  /**
   * Execute microcompact strategy (in-place truncation, no message removal).
   */
  private executeMicrocompact(
    context: CompactionContext,
    _options?: { aggressive?: boolean }
  ): CompactionResult {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    return microcompact(context.messages as Message[], {
      maxToolResultChars: 2000,
      preserveSystem: true,
    });
  }

  /**
   * Multi-layer compaction pipeline.
   *
   * Runs a sequence of increasingly aggressive compaction strategies:
   *   1. snip — remove old conversation turns (cheap, no data loss)
   *   2. microcompact — trim large tool results in-place (cheap, no removal)
   *   3. truncate-oldest — remove oldest messages (data loss, last resort)
   *
   * Each layer reduces tokens further. Stops early if tokens drop below target.
   *
   * @returns Single CompactionResult reflecting cumulative effect of all layers.
   */
  multiLayerCompact(context: CompactionContext): CompactionResult {
    const targetTokens = Math.floor(context.maxTokens * this.config.targetTokenRatio);
    let currentMessages = [...(context.messages as Message[])];
    let totalRemoved = 0;
    const tokensBefore = estimateTokens(currentMessages);

    // Layer 1: snip — preserve 5 most recent turns
    const snipResult = snipCompaction(currentMessages, 5);
    currentMessages = snipResult.messages as Message[];
    totalRemoved += snipResult.removedCount;
    if (estimateTokens(currentMessages) <= targetTokens && currentMessages.length > 0) {
      return {
        messages: currentMessages,
        removedCount: totalRemoved,
        tokensBefore,
        tokensAfter: estimateTokens(currentMessages),
        strategy: 'snip',
      };
    }

    // Layer 2: microcompact — trim tool results to 2000 chars
    // Reports 'microcompact' as the most aggressive layer applied (snip also ran)
    const microResult = microcompact(currentMessages, { maxToolResultChars: 2000 });
    currentMessages = microResult.messages as Message[];
    if (estimateTokens(currentMessages) <= targetTokens && currentMessages.length > 0) {
      return {
        messages: currentMessages,
        removedCount: totalRemoved,
        tokensBefore,
        tokensAfter: estimateTokens(currentMessages),
        strategy: 'microcompact',
      };
    }

    // Layer 3: truncate-oldest — aggressive removal
    // Reports 'truncate-oldest' as the most aggressive layer applied (snip + microcompact also ran)
    const truncResult = truncateOldest(currentMessages, Math.max(2, this.config.preserveRecent));
    totalRemoved += truncResult.removedCount;
    currentMessages = truncResult.messages as Message[];

    return {
      messages: currentMessages,
      removedCount: totalRemoved,
      tokensBefore,
      tokensAfter: estimateTokens(currentMessages),
      strategy: 'truncate-oldest',
    };
  }

  /**
   * Reactive compaction — triggered by token overflow errors (e.g., HTTP 413).
   *
   * More aggressive than normal compaction: uses 30% lower trigger threshold,
   * 50% lower target ratio, and runs the multi-layer pipeline.
   *
   * @param context - Compaction context (typically from the error path)
   * @returns Compaction result, or null if compaction is not possible
   */
  reactiveCompact(context: CompactionContext): CompactionResult | null {
    const validMessages = filterValidMessages(context.messages as unknown[]);
    if (validMessages.length <= 2) {
      // Cannot compact further — only system + user remain
      return null;
    }

    // Aggressive: trigger at 50% tokens
    if (context.currentTokenEstimate < context.maxTokens * 0.5) {
      return null; // Nothing to compact
    }

    // Use multi-layer pipeline for maximum reduction
    return this.multiLayerCompact(context);
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
  offloadManager?: HistoryOffloadManager,
  vectorStore?: VectorStore,
  embeddingModel?: EmbeddingModel
): CompactionManager {
  return new CompactionManager({}, llmAdapter, offloadManager, vectorStore, embeddingModel);
}

/**
 * Create compaction manager with truncate-oldest strategy
 */
export function createTruncateCompactionManager(
  preserveRecent: number = 10,
  offloadManager?: HistoryOffloadManager,
  vectorStore?: VectorStore,
  embeddingModel?: EmbeddingModel
): CompactionManager {
  return new CompactionManager(
    {
      strategy: 'truncate-oldest',
      preserveRecent,
    },
    undefined,
    offloadManager,
    vectorStore,
    embeddingModel
  );
}

/**
 * Create compaction manager with summarize strategy
 */
export function createSummarizeCompactionManager(
  llmAdapter: LLMAdapter,
  preserveRecent: number = 10,
  maxSummaryLength: number = 500,
  offloadManager?: HistoryOffloadManager,
  vectorStore?: VectorStore,
  embeddingModel?: EmbeddingModel
): CompactionManager {
  return new CompactionManager(
    {
      strategy: 'summarize',
      preserveRecent,
      maxSummaryLength,
    },
    llmAdapter,
    offloadManager,
    vectorStore,
    embeddingModel
  );
}

/**
 * Create compaction manager with pointer-indexed strategy
 *
 * Requires both VectorStore and EmbeddingModel for full pointer-indexed operation.
 * Falls back to truncate-oldest if either is unavailable at compaction time.
 */
export function createPointerIndexedCompactionManager(
  vectorStore: VectorStore,
  embeddingModel: EmbeddingModel,
  preserveRecent: number = 10,
  offloadManager?: HistoryOffloadManager
): CompactionManager {
  return new CompactionManager(
    {
      strategy: 'pointer-indexed',
      preserveRecent,
    },
    undefined,
    offloadManager,
    vectorStore,
    embeddingModel
  );
}

/**
 * Create disabled compaction manager (no compaction)
 */
export function createDisabledCompactionManager(): CompactionManager {
  return new CompactionManager({ enabled: false });
}
