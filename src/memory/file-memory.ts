/**
 * AgentForge File-Based Memory Implementation
 *
 * Persistent memory stored as AGENTS.md files.
 * Supports multiple memory sources, keyword search, and prompt formatting.
 *
 * @module
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { dirname, resolve } from 'path';
import type { PersistentMemory } from './persistent.js';
import type { MemoryEntry, MemoryLoadResult, MemoryConfig } from './types.js';
import { DEFAULT_MEMORY_CONFIG } from './types.js';
import { MEMORY_SYSTEM_PROMPT } from './guidelines.js';

/**
 * File-Based Memory Implementation
 *
 * Stores memory as AGENTS.md files. Supports:
 * - Multiple memory sources (loaded in order)
 * - Keyword search (Phase 1)
 * - Prompt formatting with MEMORY_SYSTEM_PROMPT
 * - ENOENT graceful degradation (missing files are skipped)
 */
export class FileBasedMemory implements PersistentMemory {
  private config: MemoryConfig;
  private cache: Map<string, MemoryEntry[]> = new Map();

  constructor(config: Partial<MemoryConfig> = {}) {
    this.config = { ...DEFAULT_MEMORY_CONFIG, ...config };
  }

  private get encoding(): BufferEncoding {
    return (this.config.encoding ?? 'utf-8') as BufferEncoding;
  }

  async load(sources: string[]): Promise<MemoryLoadResult> {
    const entries: MemoryEntry[] = [];
    const errors: string[] = [];

    for (const source of sources) {
      try {
        const content = await readFile(source, this.encoding);
        const entry: MemoryEntry = {
          id: this.generateId(source),
          content: content.toString(),
          sourcePath: resolve(source),
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        entries.push(entry);
        this.cache.set(source, [entry]);
      } catch (error) {
        // ENOENT = file not found, skip silently
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          errors.push(`Failed to load ${source}: ${(error as Error).message}`);
        }
      }
    }

    const result: MemoryLoadResult = {
      success: errors.length === 0,
      entries,
    };
    if (errors.length > 0) {
      result.error = errors.join('; ');
    }
    return result;
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- sync search is intentional for Phase 1
  async search(query: string, limit = 5): Promise<MemoryEntry[]> {
    const allEntries = Array.from(this.cache.values()).flat();
    const queryTerms = query.toLowerCase().split(/\s+/).filter(t => t.length > 2);

    if (queryTerms.length === 0) return [];

    const scored = allEntries.map(entry => {
      const contentLower = entry.content.toLowerCase();
      const score = queryTerms.filter(t => contentLower.includes(t)).length;
      return { entry, score };
    });

    return scored
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(s => s.entry);
  }

  async save(entry: MemoryEntry): Promise<boolean> {
    try {
      const dir = dirname(entry.sourcePath);
      await mkdir(dir, { recursive: true });

      // Append to existing file
      let existing = '';
      try {
        existing = await readFile(entry.sourcePath, this.encoding);
      } catch {
        // File doesn't exist, create new
      }

      const timestamp = new Date().toISOString();
      const newSection = `\n\n## ${timestamp}\n\n${entry.content}\n`;
      await writeFile(entry.sourcePath, existing + newSection, this.encoding);

      // Update cache
      const cached = this.cache.get(entry.sourcePath) ?? [];
      cached.push({ ...entry, updatedAt: Date.now() });
      this.cache.set(entry.sourcePath, cached);

      return true;
    } catch {
      return false;
    }
  }

  async update(id: string, content: string): Promise<boolean> {
    for (const [path, entries] of this.cache) {
      const idx = entries.findIndex(e => e.id === id);
      if (idx >= 0) {
        entries[idx] = { ...entries[idx]!, content, updatedAt: Date.now() };
        const allContent = entries.map(e => e.content).join('\n\n---\n\n');
        await writeFile(path, allContent, this.encoding);
        return true;
      }
    }
    return false;
  }

  async delete(id: string): Promise<boolean> {
    for (const [path, entries] of this.cache) {
      const idx = entries.findIndex(e => e.id === id);
      if (idx >= 0) {
        entries.splice(idx, 1);
        const allContent = entries.map(e => e.content).join('\n\n---\n\n');
        await writeFile(path, allContent, this.encoding);
        return true;
      }
    }
    return false;
  }

  formatForPrompt(entries: MemoryEntry[]): string {
    if (entries.length === 0) {
      return MEMORY_SYSTEM_PROMPT.replace('{agent_memory}', '(No memory loaded)');
    }

    const sections = entries.map(e => `### ${e.sourcePath}\n\n${e.content}`);
    const memoryBody = sections.join('\n\n');
    return MEMORY_SYSTEM_PROMPT.replace('{agent_memory}', memoryBody);
  }

  private generateId(sourcePath: string): string {
    const timestamp = Date.now().toString(36);
    const hash = sourcePath.split('').reduce((a, c) => ((a << 5) - a + c.charCodeAt(0)) | 0, 0);
    return `mem-${timestamp}-${Math.abs(hash).toString(36)}`;
  }
}
