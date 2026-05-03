/**
 * Working Memory Tools — add_note and pin_content for agent use.
 *
 * These tools give agents direct access to their working memory:
 * - `add_note`: Append to the scratchpad (FIFO, max 50).
 * - `pin_content`: Append to the pinned list (survives compaction).
 *
 * Both tools require a WorkingMemory reference passed via factory function.
 *
 * @module
 */

import { z } from 'zod';
import type { ToolDefinition } from '../core/interfaces.js';
import type { WorkingMemory } from '../memory/working-memory.js';
import { WorkingMemoryProcessor } from '../memory/working-memory.js';

// ============================================================
// add_note Tool
// ============================================================

const AddNoteSchema = z.object({
  note: z.string().min(1).describe('The note to add to the scratchpad (FIFO, max 50 entries).'),
});

/**
 * Create the `add_note` tool.
 *
 * Allows agents to jot down transient notes in their scratchpad.
 * Notes are FIFO with a max of 50 entries — oldest notes are evicted.
 *
 * @param memory - Shared WorkingMemory reference (mutated by the tool)
 * @returns ToolDefinition
 */
export function createAddNoteTool(memory: WorkingMemory): ToolDefinition {
  const processor = new WorkingMemoryProcessor();

  return {
    name: 'add_note',
    description:
      'Add a note to your scratchpad. ' +
      'Use this for temporary notes, observations, or intermediate results. ' +
      'Scratchpad is FIFO with a maximum of 50 entries — oldest notes are automatically evicted. ' +
      'Scratchpad content is injected into your context as <working-memory>.',
    parameters: AddNoteSchema,
    // eslint-disable-next-line @typescript-eslint/require-await
    execute: async (args: unknown): Promise<string> => {
      const parsed = AddNoteSchema.safeParse(args);
      if (!parsed.success) {
        return `Error: Invalid arguments. ${parsed.error.message}`;
      }

      const { note } = parsed.data;
      processor.addScratchpadNote(memory, note);
      return `Note added to scratchpad. Total notes: ${memory.scratchpad.length}`;
    },
  };
}

// ============================================================
// pin_content Tool
// ============================================================

const PinContentSchema = z.object({
  content: z.string().min(1).describe('The content to pin. Pinned items survive compaction.'),
});

/**
 * Create the `pin_content` tool.
 *
 * Allows agents to pin important content that should persist across
 * context compaction. Pinned items are injected as &lt;working-memory&gt;
 * before each LLM call.
 *
 * Deduplication: identical content is not re-pinned.
 *
 * @param memory - Shared WorkingMemory reference (mutated by the tool)
 * @returns ToolDefinition
 */
export function createPinContentTool(memory: WorkingMemory): ToolDefinition {
  const processor = new WorkingMemoryProcessor();

  return {
    name: 'pin_content',
    description:
      'Pin important content to your working memory. ' +
      'Pinned items survive context compaction and are always injected ' +
      'into your context as <working-memory>. Use this for critical facts, ' +
      'decisions, constraints, or persistent state you must not forget. ' +
      'Duplicates are silently ignored.',
    parameters: PinContentSchema,
    // eslint-disable-next-line @typescript-eslint/require-await
    execute: async (args: unknown): Promise<string> => {
      const parsed = PinContentSchema.safeParse(args);
      if (!parsed.success) {
        return `Error: Invalid arguments. ${parsed.error.message}`;
      }

      const { content } = parsed.data;
      const prevCount = memory.pinned.length;
      processor.pin(memory, content);
      const wasNew = memory.pinned.length > prevCount;
      return wasNew
        ? `Content pinned. Total pinned items: ${memory.pinned.length}`
        : `Content already pinned (duplicate ignored). Total pinned items: ${memory.pinned.length}`;
    },
  };
}
