/**
 * Working Memory Tests
 *
 * Tests for WorkingMemoryProcessor and associated tools.
 * Covers: pinned management, scratchpad FIFO, XML injection, tool integration.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { Message } from '../../src/core/events.js';
import {
  type WorkingMemory,
  createWorkingMemory,
  WorkingMemoryProcessor,
} from '../../src/memory/working-memory.js';
import {
  createAddNoteTool,
  createPinContentTool,
} from '../../src/tools/working-memory-tools.js';

// ============================================================
// Helpers
// ============================================================

function createMessages(count: number): Message[] {
  const messages: Message[] = [];
  for (let i = 0; i < count; i++) {
    messages.push({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `Message ${i}: some content here.`,
    });
  }
  return messages;
}

// ============================================================
// WorkingMemoryProcessor Tests
// ============================================================

describe('WorkingMemoryProcessor', () => {
  let processor: WorkingMemoryProcessor;
  let memory: WorkingMemory;

  beforeEach(() => {
    processor = new WorkingMemoryProcessor();
    memory = createWorkingMemory();
  });

  // ── process() ──

  describe('process()', () => {
    it('should extract pinned content from pin_content tool results', () => {
      const msgs: Message[] = [
        { role: 'user', content: 'Pin this: important fact' },
        {
          role: 'tool',
          name: 'pin_content',
          content: 'important fact',
        },
      ];

      processor.process(msgs, memory);

      expect(memory.pinned).toContain('important fact');
      expect(memory.updatedAt).toBeGreaterThan(0);
    });

    it('should not add duplicate pinned items', () => {
      memory.pinned = ['existing item'];

      const msgs: Message[] = [
        {
          role: 'tool',
          name: 'pin_content',
          content: 'existing item',
        },
      ];

      processor.process(msgs, memory);

      expect(memory.pinned).toEqual(['existing item']);
    });

    it('should extract pinned content from existing working-memory XML', () => {
      const msgs: Message[] = [
        {
          role: 'system',
          content:
            '<working-memory>\n<pinned>\n<item>item-from-xml</item>\n</pinned>\n</working-memory>',
        },
      ];

      processor.process(msgs, memory);

      expect(memory.pinned).toContain('item-from-xml');
    });

    it('should handle empty messages gracefully', () => {
      processor.process([], memory);

      expect(memory.pinned).toEqual([]);
      expect(memory.updatedAt).toBeGreaterThan(0);
    });

    it('should handle messages with no pinned content', () => {
      const msgs = createMessages(5);
      memory.pinned = ['kept'];

      processor.process(msgs, memory);

      // Existing pinned items should be preserved
      expect(memory.pinned).toEqual(['kept']);
    });

    it('should update the updatedAt timestamp', () => {
      const before = Date.now() - 1000;
      memory.updatedAt = before;

      processor.process(createMessages(2), memory);

      expect(memory.updatedAt).toBeGreaterThan(before);
    });
  });

  // ── generateSystemInjection() ──

  describe('generateSystemInjection()', () => {
    it('should produce XML with pinned items', () => {
      memory.pinned = ['fact one', 'fact two'];

      const xml = processor.generateSystemInjection(memory);

      expect(xml).not.toBeNull();
      expect(xml).toContain('<working-memory>');
      expect(xml).toContain('<pinned>');
      expect(xml).toContain('<item>fact one</item>');
      expect(xml).toContain('<item>fact two</item>');
      expect(xml).toContain('</pinned>');
      expect(xml).toContain('</working-memory>');
    });

    it('should produce XML with scratchpad notes', () => {
      memory.scratchpad = ['note A', 'note B'];

      const xml = processor.generateSystemInjection(memory);

      expect(xml).not.toBeNull();
      expect(xml).toContain('<scratchpad>');
      expect(xml).toContain('<note>note A</note>');
      expect(xml).toContain('<note>note B</note>');
      expect(xml).toContain('</scratchpad>');
    });

    it('should produce XML with summary when present', () => {
      memory.summary = 'Session overview text';
      memory.pinned = ['item'];

      const xml = processor.generateSystemInjection(memory);

      expect(xml).not.toBeNull();
      expect(xml).toContain('<summary>Session overview text</summary>');
    });

    it('should return null when memory is empty', () => {
      // Empty memory: no pinned, no scratchpad, no summary
      memory.pinned = [];
      memory.scratchpad = [];
      memory.summary = undefined;

      const xml = processor.generateSystemInjection(memory);

      expect(xml).toBeNull();
    });

    it('should return null when all fields are empty strings/arrays', () => {
      memory.pinned = [];
      memory.scratchpad = [];
      memory.summary = '';

      const xml = processor.generateSystemInjection(memory);

      expect(xml).toBeNull();
    });

    it('should escape XML special characters in pinned items', () => {
      memory.pinned = ['<script>alert("xss")</script>'];

      const xml = processor.generateSystemInjection(memory);

      expect(xml).not.toBeNull();
      expect(xml).toContain('&lt;script&gt;');
      expect(xml).toContain('&quot;xss&quot;');
      expect(xml).not.toContain('<script>');
    });

    it('should escape XML special characters in scratchpad notes', () => {
      memory.scratchpad = ['a < b && c > d'];

      const xml = processor.generateSystemInjection(memory);

      expect(xml).not.toBeNull();
      expect(xml).toContain('a &lt; b &amp;&amp; c &gt; d');
    });

    it('should include both pinned and scratchpad sections', () => {
      memory.pinned = ['pinned item'];
      memory.scratchpad = ['scratch note'];

      const xml = processor.generateSystemInjection(memory);

      expect(xml).not.toBeNull();
      expect(xml).toContain('<pinned>');
      expect(xml).toContain('<scratchpad>');
    });
  });

  // ── pin() ──

  describe('pin()', () => {
    it('should add content to pinned list', () => {
      processor.pin(memory, 'important note');

      expect(memory.pinned).toEqual(['important note']);
    });

    it('should not add duplicate content', () => {
      processor.pin(memory, 'note');
      processor.pin(memory, 'note');

      expect(memory.pinned).toEqual(['note']);
    });

    it('should trim whitespace before pinning', () => {
      processor.pin(memory, '  trimmed note  ');

      expect(memory.pinned).toEqual(['trimmed note']);
    });

    it('should not add empty content', () => {
      processor.pin(memory, '   ');

      expect(memory.pinned).toEqual([]);
    });

    it('should update updatedAt timestamp', () => {
      const before = Date.now() - 1000;
      memory.updatedAt = before;

      processor.pin(memory, 'new item');

      expect(memory.updatedAt).toBeGreaterThan(before);
    });
  });

  // ── unpin() ──

  describe('unpin()', () => {
    it('should remove existing pinned content', () => {
      memory.pinned = ['item1', 'item2', 'item3'];

      processor.unpin(memory, 'item2');

      expect(memory.pinned).toEqual(['item1', 'item3']);
    });

    it('should be a no-op when content is not pinned', () => {
      memory.pinned = ['item1', 'item2'];

      processor.unpin(memory, 'nonexistent');

      expect(memory.pinned).toEqual(['item1', 'item2']);
    });

    it('should update updatedAt even when no change', () => {
      const before = Date.now() - 1000;
      memory.updatedAt = before;
      memory.pinned = ['item1'];

      processor.unpin(memory, 'nonexistent');

      expect(memory.updatedAt).toBeGreaterThan(before);
    });
  });

  // ── addScratchpadNote() ──

  describe('addScratchpadNote()', () => {
    it('should add note to scratchpad', () => {
      processor.addScratchpadNote(memory, 'note one');

      expect(memory.scratchpad).toEqual(['note one']);
    });

    it('should add multiple notes', () => {
      processor.addScratchpadNote(memory, 'note one');
      processor.addScratchpadNote(memory, 'note two');

      expect(memory.scratchpad).toEqual(['note one', 'note two']);
    });

    it('should trim whitespace', () => {
      processor.addScratchpadNote(memory, '  padded  ');

      expect(memory.scratchpad).toEqual(['padded']);
    });

    it('should not add empty notes', () => {
      processor.addScratchpadNote(memory, '');

      expect(memory.scratchpad).toEqual([]);
    });

    it('should update updatedAt timestamp', () => {
      const before = Date.now() - 1000;
      memory.updatedAt = before;

      processor.addScratchpadNote(memory, 'new note');

      expect(memory.updatedAt).toBeGreaterThan(before);
    });

    it('should evict oldest note when exceeding 50 entries (FIFO)', () => {
      // Fill to exactly 50
      for (let i = 0; i < 50; i++) {
        processor.addScratchpadNote(memory, `note ${i}`);
      }
      expect(memory.scratchpad).toHaveLength(50);
      expect(memory.scratchpad[0]).toBe('note 0');

      // Add 51st — should evict 'note 0'
      processor.addScratchpadNote(memory, 'note 50');
      expect(memory.scratchpad).toHaveLength(50);
      expect(memory.scratchpad[0]).toBe('note 1');
      expect(memory.scratchpad[49]).toBe('note 50');
    });

    it('should maintain FIFO order with many evictions', () => {
      // Add 60 notes
      for (let i = 0; i < 60; i++) {
        processor.addScratchpadNote(memory, `note ${i}`);
      }

      // Should have 50 notes: 10-59
      expect(memory.scratchpad).toHaveLength(50);
      expect(memory.scratchpad[0]).toBe('note 10');
      expect(memory.scratchpad[49]).toBe('note 59');
    });
  });

  // ── clearScratchpad() ──

  describe('clearScratchpad()', () => {
    it('should empty the scratchpad', () => {
      memory.scratchpad = ['note1', 'note2', 'note3'];

      processor.clearScratchpad(memory);

      expect(memory.scratchpad).toEqual([]);
    });

    it('should preserve pinned items when clearing scratchpad', () => {
      memory.pinned = ['important'];
      memory.scratchpad = ['note1', 'note2'];

      processor.clearScratchpad(memory);

      expect(memory.pinned).toEqual(['important']);
    });

    it('should update updatedAt timestamp', () => {
      const before = Date.now() - 1000;
      memory.updatedAt = before;
      memory.scratchpad = ['note'];

      processor.clearScratchpad(memory);

      expect(memory.updatedAt).toBeGreaterThan(before);
    });
  });

  // ── createSystemInjectionHook() ──

  describe('createSystemInjectionHook()', () => {
    it('should create a hook with correct name and priority', () => {
      const hook = processor.createSystemInjectionHook(memory, 25);

      expect(hook.name).toBe('working-memory-injection');
      expect(hook.priority).toBe(25);
    });

    it('should prepend system message when memory has content', () => {
      memory.pinned = ['pinned fact'];
      const hook = processor.createSystemInjectionHook(memory, 25);

      const messages: Message[] = [
        { role: 'user', content: 'Hello' },
      ];

      const result = hook.apply(messages, null as never);

      expect(result).toHaveLength(2);
      expect(result[0]!.role).toBe('system');
      expect(result[0]!.name).toBe('working-memory');
      expect(typeof result[0]!.content).toBe('string');
      expect(result[0]!.content as string).toContain('<working-memory>');
      expect(result[1]).toEqual(messages[0]);
    });

    it('should return messages unchanged when memory is empty', () => {
      const hook = processor.createSystemInjectionHook(memory, 25);

      const messages: Message[] = [
        { role: 'user', content: 'Hello' },
      ];

      const result = hook.apply(messages, null as never);

      expect(result).toEqual(messages);
    });
  });
});

// ============================================================
// Tool Tests
// ============================================================

describe('working memory tools', () => {
  let memory: WorkingMemory;

  beforeEach(() => {
    memory = createWorkingMemory();
  });

  // ── add_note ──

  describe('add_note tool', () => {
    it('should append note to scratchpad', async () => {
      const tool = createAddNoteTool(memory);
      const result = await tool.execute({ note: 'observation: server returned 200' });

      expect(memory.scratchpad).toEqual(['observation: server returned 200']);
      expect(result).toContain('Note added to scratchpad');
      expect(result).toContain('Total notes: 1');
    });

    it('should reflect count after multiple notes', async () => {
      const tool = createAddNoteTool(memory);
      await tool.execute({ note: 'first note' });
      await tool.execute({ note: 'second note' });
      const result = await tool.execute({ note: 'third note' });

      expect(memory.scratchpad).toHaveLength(3);
      expect(result).toContain('Total notes: 3');
    });

    it('should reject empty note', async () => {
      const tool = createAddNoteTool(memory);
      const result = await tool.execute({ note: '' });

      expect(result).toContain('Error');
      expect(memory.scratchpad).toEqual([]);
    });

    it('should reject missing note field', async () => {
      const tool = createAddNoteTool(memory);
      const result = await tool.execute({});

      // Should still populate memory with zod defaults? No — should error
      expect(result).toContain('Error');
    });
  });

  // ── pin_content ──

  describe('pin_content tool', () => {
    it('should append content to pinned list', async () => {
      const tool = createPinContentTool(memory);
      const result = await tool.execute({ content: 'User prefers dark mode' });

      expect(memory.pinned).toContain('User prefers dark mode');
      expect(result).toContain('Content pinned');
      expect(result).toContain('Total pinned items: 1');
    });

    it('should detect duplicates', async () => {
      const tool = createPinContentTool(memory);
      await tool.execute({ content: 'important fact' });
      const result = await tool.execute({ content: 'important fact' });

      expect(memory.pinned).toHaveLength(1);
      expect(result).toContain('already pinned');
    });

    it('should reject empty content', async () => {
      const tool = createPinContentTool(memory);
      const result = await tool.execute({ content: '' });

      expect(result).toContain('Error');
      expect(memory.pinned).toEqual([]);
    });

    it('should reject missing content field', async () => {
      const tool = createPinContentTool(memory);
      const result = await tool.execute({});

      expect(result).toContain('Error');
    });

    it('should allow multiple unique pinned items', async () => {
      const tool = createPinContentTool(memory);
      await tool.execute({ content: 'fact A' });
      await tool.execute({ content: 'fact B' });

      expect(memory.pinned).toEqual(['fact A', 'fact B']);
    });
  });
});

// ============================================================
// Integration Tests
// ============================================================

describe('working memory integration', () => {
  it('should preserve pinned items across processor and hook chain', () => {
    const processor = new WorkingMemoryProcessor();
    const memory = createWorkingMemory();

    // Simulate: agent pins content via tool
    processor.pin(memory, 'critical constraint: max 10 requests');

    // Simulate: compaction happens, process extracts metadata
    const messages = createMessages(20);
    processor.process(messages, memory);

    // pinned item should survive
    expect(memory.pinned).toContain('critical constraint: max 10 requests');

    // Simulate: hook generates injection
    const xml = processor.generateSystemInjection(memory);
    expect(xml).toContain('critical constraint: max 10 requests');
  });

  it('should handle full lifecycle: pin → compact → inject → use', () => {
    const processor = new WorkingMemoryProcessor();
    const memory = createWorkingMemory();

    // 1. Agent uses pin_content tool
    processor.pin(memory, 'decision: use PostgreSQL');

    // 2. Agent adds scratchpad notes
    processor.addScratchpadNote(memory, 'checked: Postgres version 16 available');
    processor.addScratchpadNote(memory, 'considered: SQLite — rejected for scale');

    // 3. Compaction extracts metadata from messages
    const msgs: Message[] = [
      ...createMessages(5),
      { role: 'tool', name: 'pin_content', content: 'decision: use PostgreSQL' },
      ...createMessages(5),
    ];
    processor.process(msgs, memory);

    // 4. Hook generates injection
    const injection = processor.generateSystemInjection(memory);
    expect(injection).toContain('decision: use PostgreSQL');
    expect(injection).toContain('checked: Postgres version 16 available');
    expect(injection).toContain('considered: SQLite');
  });
});
