/**
 * AgentForge History Offload Manager
 *
 * Persists old messages to markdown files during compaction.
 * Each summarization event appends a timestamped section.
 *
 * Reference: DeepAgents SummarizationMiddleware._offload_to_backend()
 *
 * @module
 */

import { writeFile, readFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import type { Message } from '../core/events.js';
import type { OffloadConfig } from './types.js';
import { DEFAULT_OFFLOAD_CONFIG } from './types.js';
import { extractText } from '../core/content-utils.js';

/**
 * History Offload Manager
 *
 * Saves old conversation messages to markdown files during compaction.
 * Messages are appended as timestamped sections for human readability.
 *
 * File format:
 * ```markdown
 * ## Summarized at 2026-04-27T10:30:00Z
 *
 * [user]: Hello
 * [assistant]: Hi there!
 *
 * ## Summarized at 2026-04-27T11:00:00Z
 *
 * [user]: What's the weather?
 * [assistant]: It's sunny today.
 * ```
 */
export class HistoryOffloadManager {
  private config: OffloadConfig;

  constructor(config: Partial<OffloadConfig> = {}) {
    this.config = { ...DEFAULT_OFFLOAD_CONFIG, ...config };
  }

  /**
   * Offload messages to a markdown file
   *
   * @param sessionId - Session ID (used in filename)
   * @param messages - Messages to offload
   * @returns File path on success, null on failure
   */
  async offload(sessionId: string, messages: Message[]): Promise<string | null> {
    if (!this.config.enabled || messages.length === 0) {
      return null;
    }

    const filePath = this.getFilePath(sessionId);

    try {
      await mkdir(dirname(filePath), { recursive: true });

      const timestamp = new Date().toISOString();
      const formatted = this.formatMessages(messages);
      const newSection = `## Summarized at ${timestamp}\n\n${formatted}\n\n`;

      // Read existing content and append
      let existing = '';
      try {
        existing = await readFile(filePath, 'utf-8');
      } catch {
        // File doesn't exist yet, create new
      }

      await writeFile(filePath, existing + newSection, 'utf-8');
      return filePath;
    } catch (error) {
      console.warn(`Failed to offload history to ${filePath}:`, error);
      return null;
    }
  }

  /**
   * Load history from file
   *
   * @param sessionId - Session ID
   * @returns File content or null if not found
   */
  async load(sessionId: string): Promise<string | null> {
    const filePath = this.getFilePath(sessionId);
    try {
      return await readFile(filePath, 'utf-8');
    } catch {
      return null;
    }
  }

  private getFilePath(sessionId: string): string {
    const filename = this.config.filenameTemplate.replace('{sessionId}', sessionId);
    return join(this.config.historyDir, filename);
  }

  private formatMessages(messages: Message[]): string {
    return messages
      .filter(m => m.role !== 'system') // Skip system messages
      .map(m => {
        const name = m.name ? ` (${m.name})` : '';
        return `[${m.role}${name}]: ${extractText(m.content)}`;
      })
      .join('\n\n');
  }
}
