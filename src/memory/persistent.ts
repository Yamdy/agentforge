/**
 * AgentForge Persistent Memory Interface
 *
 * Interface for loading, searching, and saving persistent memory.
 * Memory is stored as AGENTS.md files and injected into system prompts.
 *
 * @module
 */

import type { MemoryEntry, MemoryLoadResult } from './types.js';

/**
 * Persistent Memory Interface
 *
 * Manages cross-session memory stored as AGENTS.md files.
 * Implementations handle file I/O, caching, and search.
 */
export interface PersistentMemory {
  /**
   * Load memory from file paths
   *
   * @param sources - AGENTS.md file paths
   * @returns Load result with entries and errors
   */
  load(sources: string[]): Promise<MemoryLoadResult>;

  /**
   * Search memories by keywords
   *
   * @param query - Search query
   * @param limit - Max results (default: 5)
   * @returns Matching memory entries
   */
  search(query: string, limit?: number): Promise<MemoryEntry[]>;

  /**
   * Save a new memory entry
   *
   * @param entry - Memory entry to save
   * @returns Whether save succeeded
   */
  save(entry: MemoryEntry): Promise<boolean>;

  /**
   * Update an existing memory entry
   *
   * @param id - Memory entry ID
   * @param content - New content
   * @returns Whether update succeeded
   */
  update(id: string, content: string): Promise<boolean>;

  /**
   * Delete a memory entry
   *
   * @param id - Memory entry ID
   * @returns Whether delete succeeded
   */
  delete(id: string): Promise<boolean>;

  /**
   * Format memory entries for system prompt injection
   *
   * @param entries - Memory entries to format
   * @returns Formatted prompt text
   */
  formatForPrompt(entries: MemoryEntry[]): string;

  /**
   * Vector search (Phase 3 - optional)
   *
   * @param query - Search query
   * @param limit - Max results
   * @returns Matching entries
   */
  vectorSearch?(query: string, limit?: number): Promise<MemoryEntry[]>;
}
