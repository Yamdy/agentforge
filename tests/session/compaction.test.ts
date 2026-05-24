import { describe, it, expect } from 'vitest';
import { compactMessages, estimateTokens } from '../../src/session/compaction.js';
import type { SessionMessage } from '../../src/session/types.js';

describe('Compaction', () => {
  it('should estimate tokens correctly', () => {
    const text = 'Hello, world! This is a test message.';
    const tokens = estimateTokens(text);
    expect(tokens).toBeGreaterThan(0);
    expect(tokens).toBeLessThan(text.length);
  });

  it('should compact messages when exceeding max', () => {
    const messages: SessionMessage[] = [];
    for (let i = 0; i < 100; i++) {
      messages.push({
        role: 'user',
        content: `Message ${i}`,
        timestamp: Date.now() + i,
      });
    }

    const result = compactMessages(messages, { maxMessages: 20 });
    expect(result.messages.length).toBeLessThanOrEqual(20);
    expect(result.originalCount).toBe(100);
    expect(result.savedTokens).toBeGreaterThan(0);
  });

  it('should keep system messages', () => {
    const messages: SessionMessage[] = [
      { role: 'system', content: 'System prompt', timestamp: Date.now() },
      ...Array.from({ length: 50 }, (_, i) => ({
        role: 'user' as const,
        content: `Message ${i}`,
        timestamp: Date.now() + i,
      })),
    ];

    const result = compactMessages(messages, {
      maxMessages: 20,
      keepSystemMessages: true,
    });

    const systemMessages = result.messages.filter((m) => m.role === 'system');
    expect(systemMessages).toHaveLength(1);
  });

  it('should keep tool results when configured', () => {
    const messages: SessionMessage[] = [
      { role: 'tool', content: 'Tool result 1', toolCallId: '1', toolName: 'test', timestamp: Date.now() },
      ...Array.from({ length: 50 }, (_, i) => ({
        role: 'user' as const,
        content: `Message ${i}`,
        timestamp: Date.now() + i,
      })),
    ];

    const result = compactMessages(messages, {
      maxMessages: 20,
      keepToolResults: true,
    });

    const toolMessages = result.messages.filter((m) => m.role === 'tool');
    expect(toolMessages).toHaveLength(1);
  });
});
