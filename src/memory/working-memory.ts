/**
 * Working Memory — short-term memory with pinned items and scratchpad.
 *
 * Provides agents with a lightweight, editable memory surface that persists
 * across compaction cycles. Pinned items survive compaction; scratchpad is
 * a FIFO log of transient notes.
 *
 * Integration points:
 * - CompactionManager: preserves pinned content before message removal
 * - AgentLoop RequestHook: injects &lt;working-memory&gt; XML before LLM calls
 * - Tools: add_note (scratchpad) and pin_content (pinned) for agent use
 *
 * @module
 */

import type { Message } from '../core/events.js';

// ============================================================
// WorkingMemory Interface
// ============================================================

/**
 * Short-term working memory for agents.
 *
 * - `pinned`: Items the agent explicitly wants to keep across compaction.
 * - `scratchpad`: FIFO queue of transient notes (max 50).
 * - `summary`: Optional summary of the working memory (populated by process()).
 * - `updatedAt`: Last modification timestamp (ms since epoch).
 */
export interface WorkingMemory {
  pinned: string[];
  scratchpad: string[];
  summary?: string;
  updatedAt?: number;
}

/**
 * Create a fresh WorkingMemory instance.
 */
export function createWorkingMemory(): WorkingMemory {
  return {
    pinned: [],
    scratchpad: [],
    updatedAt: Date.now(),
  };
}

// ============================================================
// WorkingMemoryProcessor
// ============================================================

/**
 * Processes and formats WorkingMemory data.
 *
 * Responsibilities:
 * - Extract pinned metadata from conversation messages
 * - Generate XML system injection for the LLM
 * - Manage pinned and scratchpad items
 */
export class WorkingMemoryProcessor {
  /** Maximum number of scratchpad entries (FIFO eviction) */
  private static readonly MAX_SCRATCHPAD = 50;

  // ── Metadata Extraction ──

  /**
   * Extract pinned metadata from messages and populate the working memory.
   *
   * This method scans the conversation for:
   * - Tool result messages from `pin_content` (pinned items)
   * - System messages containing `<working-memory>` blocks (re-ingest)
   * - Agent messages that reference pinned items
   *
   * @param messages - Current conversation messages
   * @param memory   - WorkingMemory to update in-place
   */
  process(messages: Message[], memory: WorkingMemory): void {
    // Scan messages for tool results from pin_content
    // Tool result format: role='tool', name='pin_content', content=the_pinned_value
    for (const msg of messages) {
      if (msg.role === 'tool' && msg.name === 'pin_content' && typeof msg.content === 'string') {
        const content = msg.content.trim();
        if (content.length > 0 && !memory.pinned.includes(content)) {
          memory.pinned.push(content);
        }
      }
    }

    // Scan system messages for previously injected working-memory blocks
    // to re-populate pinned items that may have been lost
    for (const msg of messages) {
      if (msg.role === 'system' && typeof msg.content === 'string') {
        const pinned = this.extractPinnedFromXml(msg.content);
        for (const item of pinned) {
          if (!memory.pinned.includes(item)) {
            memory.pinned.push(item);
          }
        }
      }
    }

    // Update timestamp
    memory.updatedAt = Date.now();
  }

  /**
   * Extract pinned item content from `<working-memory>` XML.
   */
  private extractPinnedFromXml(content: string): string[] {
    const results: string[] = [];
    // Match <item>content</item> blocks inside <pinned> sections
    const pinnedSection = content.match(/<pinned>([\s\S]*?)<\/pinned>/);
    if (pinnedSection?.[1]) {
      const itemMatches = pinnedSection[1].matchAll(/<item>([\s\S]*?)<\/item>/g);
      for (const m of itemMatches) {
        if (m[1]) {
          const item = m[1].trim();
          if (item.length > 0) results.push(item);
        }
      }
    }
    return results;
  }

  // ── System Injection ──

  /**
   * Generate the `<working-memory>` XML block for LLM system prompt injection.
   *
   * Returns the formatted XML string if the working memory is non-empty,
   * or `null` if there is nothing to inject.
   *
   * @param memory - WorkingMemory to format
   * @returns XML string or null
   */
  generateSystemInjection(memory: WorkingMemory): string | null {
    const hasPinned = memory.pinned.length > 0;
    const hasScratchpad = memory.scratchpad.length > 0;
    const hasSummary = typeof memory.summary === 'string' && memory.summary.length > 0;

    if (!hasPinned && !hasScratchpad && !hasSummary) {
      return null;
    }

    const lines: string[] = ['<working-memory>'];

    if (hasSummary) {
      lines.push(`<summary>${this.escapeXml(memory.summary!)}</summary>`);
    }

    if (hasPinned) {
      lines.push('<pinned>');
      for (const item of memory.pinned) {
        lines.push(`<item>${this.escapeXml(item)}</item>`);
      }
      lines.push('</pinned>');
    }

    if (hasScratchpad) {
      lines.push('<scratchpad>');
      for (const note of memory.scratchpad) {
        lines.push(`<note>${this.escapeXml(note)}</note>`);
      }
      lines.push('</scratchpad>');
    }

    lines.push('</working-memory>');
    return lines.join('\n');
  }

  /**
   * Create a RequestHook that injects `<working-memory>` before LLM calls.
   *
   * The hook prepends a system message containing the working memory XML
   * at the configured priority tier.
   *
   * @param memory  - WorkingMemory reference (mutated externally)
   * @param priority - RequestHookPriority tier (use WORKING_MEMORY = 25)
   * @returns RequestHook compatible with HookRegistry
   */
  createSystemInjectionHook(
    memory: WorkingMemory,
    priority: number
  ): import('../core/hooks.js').RequestHook {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const processor = this;
    return {
      name: 'working-memory-injection',
      priority,
      apply(messages: Message[]): Message[] {
        const injection = processor.generateSystemInjection(memory);
        if (injection === null) {
          return messages;
        }
        return [{ role: 'system', content: injection, name: 'working-memory' }, ...messages];
      },
    };
  }

  // ── Pin Management ──

  /**
   * Add content to the pinned list.
   *
   * Deduplication: if the content already exists in pinned, it is not re-added.
   *
   * @param memory  - WorkingMemory to mutate
   * @param content - Content to pin
   */
  pin(memory: WorkingMemory, content: string): void {
    const trimmed = content.trim();
    if (trimmed.length === 0) return;
    if (!memory.pinned.includes(trimmed)) {
      memory.pinned.push(trimmed);
    }
    memory.updatedAt = Date.now();
  }

  /**
   * Remove content from the pinned list.
   *
   * @param memory  - WorkingMemory to mutate
   * @param content - Content to unpin (exact match)
   */
  unpin(memory: WorkingMemory, content: string): void {
    const idx = memory.pinned.indexOf(content);
    if (idx >= 0) {
      memory.pinned.splice(idx, 1);
    }
    memory.updatedAt = Date.now();
  }

  // ── Scratchpad Management ──

  /**
   * Add a note to the scratchpad (FIFO, max 50 entries).
   *
   * When the scratchpad exceeds {@link MAX_SCRATCHPAD} entries, the oldest
   * note is evicted (shift from front).
   *
   * @param memory - WorkingMemory to mutate
   * @param note   - Note to add
   */
  addScratchpadNote(memory: WorkingMemory, note: string): void {
    const trimmed = note.trim();
    if (trimmed.length === 0) return;
    memory.scratchpad.push(trimmed);
    while (memory.scratchpad.length > WorkingMemoryProcessor.MAX_SCRATCHPAD) {
      memory.scratchpad.shift();
    }
    memory.updatedAt = Date.now();
  }

  /**
   * Clear all scratchpad entries.
   *
   * @param memory - WorkingMemory to mutate
   */
  clearScratchpad(memory: WorkingMemory): void {
    memory.scratchpad = [];
    memory.updatedAt = Date.now();
  }

  // ── Helpers ──

  /**
   * Escape special XML characters in content.
   */
  private escapeXml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }
}
