/**
 * AgentForge Memory Management
 *
 * Public API for context window management and compaction.
 *
 * @module
 */

// ============================================================
// Strategies
// ============================================================

export {
  CompactionStrategySchema,
  type CompactionStrategy,
  CompactionResultSchema,
  type CompactionResult,
  estimateTokens,
  estimateMessageTokens,
  truncateOldest,
  summarize,
  importanceWeighted,
  type PreserveConfig,
  type MessageImportance,
} from './strategies.js';

// ============================================================
// Compaction Manager
// ============================================================

export {
  CompactionConfigSchema,
  type CompactionConfig,
  CompactionContextSchema,
  type CompactionContext,
  CompactionManager,
  type CompactionEventPayload,
  DEFAULT_COMPACTION_CONFIG,
  createCompactionManager,
  createTruncateCompactionManager,
  createSummarizeCompactionManager,
  createDisabledCompactionManager,
} from './compaction.js';
