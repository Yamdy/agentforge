import { describe, test, expect, beforeEach } from 'vitest';
import {
  createMemory,
  InMemoryStorage,
  MessageHistory,
  WorkingMemory,
} from '../../src/memory/index.js';

describe('Memory System', () => {
  describe('MessageHistory', () => {
    let messageHistory: MessageHistory;

    beforeEach(() => {
      messageHistory = new MessageHistory({ lastMessages: 3 });
    });

    test('should add and get messages', () => {
      messageHistory.add({ role: 'user', content: 'Hello 1' });
      messageHistory.add({ role: 'user', content: 'Hello 2' });
      messageHistory.add({ role: 'user', content: 'Hello 3' });

      const messages = messageHistory.getMessages();
      expect(messages).toHaveLength(3);
      expect(messages[0].content).toBe('Hello 1');
      expect(messages[2].content).toBe('Hello 3');
    });

    test('should trim old messages', () => {
      messageHistory.add({ role: 'user', content: 'Hello 1' });
      messageHistory.add({ role: 'user', content: 'Hello 2' });
      messageHistory.add({ role: 'user', content: 'Hello 3' });
      messageHistory.add({ role: 'user', content: 'Hello 4' });

      const messages = messageHistory.getMessages();
      expect(messages).toHaveLength(3);
      expect(messages[0].content).toBe('Hello 2');
      expect(messages[2].content).toBe('Hello 4');
    });

    test('should clear messages', () => {
      messageHistory.add({ role: 'user', content: 'Hello' });
      messageHistory.clear();

      const messages = messageHistory.getMessages();
      expect(messages).toHaveLength(0);
    });
  });

  describe('WorkingMemory', () => {
    test('should create with template', () => {
      const workingMemory = new WorkingMemory({
        enabled: true,
        template: '# User Info\n- Name: Test',
      });

      expect(workingMemory.content).toBe('# User Info\n- Name: Test');
    });

    test('should update content', () => {
      const workingMemory = new WorkingMemory({ enabled: true });
      workingMemory.update('New content');

      expect(workingMemory.content).toBe('New content');
      expect(workingMemory.get()).toEqual({
        content: 'New content',
        updatedAt: expect.any(Date),
      });
    });
  });

  describe('InMemoryStorage', () => {
    let storage: InMemoryStorage;

    beforeEach(() => {
      storage = new InMemoryStorage();
    });

    test('should create and retrieve thread', async () => {
      const thread = await storage.saveThread({
        id: 'thread-1',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const retrieved = await storage.getThread('thread-1');
      expect(retrieved).toEqual(thread);
    });

    test('should add and retrieve messages', async () => {
      await storage.saveThread({
        id: 'thread-1',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await storage.addMessage('thread-1', { role: 'user', content: 'Test' });
      const messages = await storage.getMessages('thread-1');

      expect(messages).toHaveLength(1);
      expect(messages[0].content).toBe('Test');
    });

    test('should delete thread', async () => {
      await storage.saveThread({
        id: 'thread-1',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await storage.deleteThread('thread-1');
      const thread = await storage.getThread('thread-1');

      expect(thread).toBeNull();
    });
  });

  describe('MemoryManager', () => {
    test('should create with default config', async () => {
      const memory = createMemory();
      await memory.load();

      expect(memory).toBeDefined();
    });

    test('should add and get messages', async () => {
      const memory = createMemory();
      await memory.load();

      memory.addMessage({ role: 'user', content: 'Hello' });
      const messages = memory.getMessages();

      expect(messages).toHaveLength(1);
      expect(messages[0].content).toBe('Hello');
    });

    test('should work with working memory', async () => {
      const memory = createMemory({
        workingMemory: { enabled: true, template: 'Initial' },
      });
      await memory.load();

      const wm = memory.getWorkingMemory();
      expect(wm?.content).toBe('Initial');

      memory.updateWorkingMemory('Updated');
      const updated = memory.getWorkingMemory();
      expect(updated?.content).toBe('Updated');
    });
  });
});
