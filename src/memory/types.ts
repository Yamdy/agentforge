/**
 * AgentForge Persistent Memory Types
 *
 * Type definitions for the persistent memory system.
 * Memory is stored as AGENTS.md files and injected into system prompts
 * via InterceptorPlugin.
 *
 * @module
 */

// ============================================================
// Memory Entry
// ============================================================

/**
 * A single memory entry loaded from an AGENTS.md file.
 */
export interface MemoryEntry {
  /** Unique identifier */
  id: string;

  /** Memory content (Markdown) */
  content: string;

  /** Source file path */
  sourcePath: string;

  /** Creation timestamp (ms) */
  createdAt: number;

  /** Last update timestamp (ms) */
  updatedAt: number;

  /** Tags for search/filtering */
  tags?: string[];
}

// ============================================================
// Memory Load Result
// ============================================================

/**
 * Result of loading memory from files.
 */
export interface MemoryLoadResult {
  /** Whether the load succeeded (partial success = true if no errors) */
  success: boolean;

  /** Loaded memory entries */
  entries: MemoryEntry[];

  /** Error messages (if any) */
  error?: string;
}

// ============================================================
// Memory Config
// ============================================================

/**
 * Configuration for persistent memory.
 */
export interface MemoryConfig {
  /** Memory file paths (AGENTS.md files) */
  sources: string[];

  /** Whether memory is enabled */
  enabled: boolean;

  /** Maximum search results */
  searchLimit?: number;

  /** File encoding */
  encoding?: string;
}

/** Default memory configuration */
export const DEFAULT_MEMORY_CONFIG: MemoryConfig = {
  sources: [],
  enabled: false,
  searchLimit: 5,
  encoding: 'utf-8',
};

// ============================================================
// Offload Config
// ============================================================

/**
 * Configuration for history offload.
 */
export interface OffloadConfig {
  /** Whether offload is enabled */
  enabled: boolean;

  /** Directory for history files */
  historyDir: string;

  /** Filename template (supports {sessionId} placeholder) */
  filenameTemplate: string;
}

/** Default offload configuration */
export const DEFAULT_OFFLOAD_CONFIG: OffloadConfig = {
  enabled: true,
  historyDir: '/conversation_history',
  filenameTemplate: '{sessionId}.md',
};
