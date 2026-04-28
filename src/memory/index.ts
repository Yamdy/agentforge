/**
 * AgentForge Memory Management
 *
 * Public API for context window management, compaction, and persistent memory.
 *
 * @module
 */

// ============================================================
// Types
// ============================================================

export {
  type MemoryEntry,
  type MemoryLoadResult,
  type MemoryConfig,
  DEFAULT_MEMORY_CONFIG,
  type OffloadConfig,
  DEFAULT_OFFLOAD_CONFIG,
} from './types.js';

// ============================================================
// Persistent Memory Interface
// ============================================================

export type { PersistentMemory } from './persistent.js';

// ============================================================
// File-Based Memory
// ============================================================

export { FileBasedMemory } from './file-memory.js';

// ============================================================
// Memory Guidelines
// ============================================================

export { MEMORY_SYSTEM_PROMPT } from './guidelines.js';

// ============================================================
// History Offload
// ============================================================

export { HistoryOffloadManager } from './history-offload.js';

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
