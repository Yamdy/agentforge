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
// Persistent Memory Store (Session Persistence)
// ============================================================

export {
  type PersistentMemoryStore,
  type SessionMetadata,
  type PersistedSession,
} from './persistent-store.js';

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
// RequestHook Priority Convention (Progressive Disclosure)
// ============================================================

export {
  RequestHookPriority,
  type RequestHookPriority as RequestHookPriorityType,
} from '../core/hooks.js';

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

// ============================================================
// Embedding Models (NEW - P0)
// ============================================================

export {
  type EmbeddingModel,
  type EmbeddingModelOptions,
  OpenAIEmbeddingModel,
  GoogleEmbeddingModel,
  createEmbeddingModel,
} from './embedding.js';

// ============================================================
// Vector Store (NEW - P0)
// ============================================================

export {
  type VectorDocument,
  type VectorSearchResult,
  type VectorStore,
  cosineSimilarity,
} from './vector-store.js';

// ============================================================
// Semantic Memory (NEW - P0)
// ============================================================

export {
  type SemanticMemoryConfig,
  SemanticMemory,
  createSemanticMemory,
} from './semantic-memory.js';

// ============================================================
// AGENTS.md Auto-Discovery
// ============================================================

export { type AgentsMdConfig, type AgentsMdResult, loadAgentsMd } from './agents-md.js';

// ============================================================
// SQLite Vector Store (NEW - P0)
// ============================================================

export { type SQLiteVectorStoreOptions, SQLiteVectorStore } from './stores/sqlite.js';
