import { describe, it, expect } from 'vitest';
import { compressHistory } from '../../src/middleware/compression';

interface TestMessage {
  content: string;
  role: string;
}

describe('compression middleware', () => {
  describe('compressHistory', () => {
    it('should not compress when under message limit', async () => {
      const messages: TestMessage[] = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there' },
      ];

      const result = await compressHistory(messages, {
        maxMessagesBeforeCompression: 10,
        maxTokensBeforeCompression: 4000,
        keepRecentMessages: 3,
        summarize: async (msgs) => msgs.join('\n'),
      });

      expect(result).toEqual(messages);
      expect(result.length).toBe(2);
    });

    it('should compress when over message limit', async () => {
      // Create 15 messages
      const messages: TestMessage[] = Array.from({ length: 15 }, (_, i) => ({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `Message ${i}`,
      }));

      const result = await compressHistory(messages, {
        maxMessagesBeforeCompression: 10,
        maxTokensBeforeCompression: 4000,
        keepRecentMessages: 3,
        summarize: async (msgs) => msgs.join('\n'),
      });

      // Should have 1 summary + 3 recent = 4 messages total
      expect(result.length).toBe(4);
      expect(result.slice(-3)).toEqual(messages.slice(-3));
      expect(result[0].content).toContain('Summary of Previous Conversation');
    });

    it('should keep correct number of recent messages', async () => {
      const messages: TestMessage[] = Array.from({ length: 20 }, (_, i) => ({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `Message ${i}`,
      }));

      const keepRecent = 5;
      const result = await compressHistory(messages, {
        maxMessagesBeforeCompression: 10,
        maxTokensBeforeCompression: 4000,
        keepRecentMessages: keepRecent,
        summarize: async (msgs) => msgs.join(','),
      });

      expect(result.length).toBe(1 + keepRecent);
      expect(result.slice(-keepRecent)).toEqual(messages.slice(-keepRecent));
    });

    it('should work with custom summarization function', async () => {
      const messages: TestMessage[] = Array.from({ length: 12 }, (_, i) => ({
        role: 'user',
        content: `Question ${i + 1}`,
      }));

      const customSummary = 'This is a custom summary';
      const result = await compressHistory(messages, {
        maxMessagesBeforeCompression: 10,
        maxTokensBeforeCompression: 4000,
        keepRecentMessages: 2,
        summarize: async () => customSummary,
      });

      expect(result[0].content).toContain(customSummary);
    });
  });
});
