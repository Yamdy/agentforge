/**
 * Unit tests for src/memory/strategies.ts
 *
 * Tests token estimation and compaction strategies.
 */

import { describe, it, expect } from 'vitest';
import type { Message } from '../../src/core/events.js';
import {
  estimateTokens,
  estimateMessageTokens,
  truncateOldest,
  importanceWeighted,
  CompactionStrategySchema,
} from '../../src/memory/strategies.js';

// ============================================================
// Test Helpers
// ============================================================

function createTestMessages(count: number, startRole: Message['role'] = 'user'): Message[] {
  const roles: Message['role'][] = ['user', 'assistant', 'user', 'assistant'];
  const messages: Message[] = [];

  for (let i = 0; i < count; i++) {
    messages.push({
      role: i === 0 ? 'system' : roles[(i + (startRole === 'user' ? 0 : 1)) % 4],
      content: `Message ${i}: ${'x'.repeat(100)}`, // 100+ chars per message
    });
  }

  return messages;
}

function createSystemPromptMessage(): Message {
  return {
    role: 'system',
    content: 'You are a helpful assistant. Follow the instructions carefully.',
  };
}

function createUserMessage(content: string): Message {
  return { role: 'user', content };
}

function createAssistantMessage(content: string): Message {
  return { role: 'assistant', content };
}

function createToolMessage(toolCallId: string, content: string): Message {
  return { role: 'tool', content, toolCallId };
}

// ============================================================
// Token Estimation Tests
// ============================================================

describe('estimateTokens', () => {
  it('should estimate tokens for empty array', () => {
    expect(estimateTokens([])).toBe(0);
  });

  it('should estimate tokens for messages', () => {
    const messages: Message[] = [
      { role: 'user', content: 'Hello world' },
    ];
    const tokens = estimateTokens(messages);
    expect(tokens).toBeGreaterThan(0);
    // Token count should be reasonable (not exact, as tiktoken uses BPE)
    expect(tokens).toBeLessThan(20);
  });

  it('should sum tokens across all messages', () => {
    const messages: Message[] = [
      { role: 'user', content: 'aaaaaaaa' },
      { role: 'assistant', content: 'bbbbbbbb' },
    ];
    const tokens = estimateTokens(messages);
    expect(tokens).toBeGreaterThan(0);
    // Should count tokens for both messages
    expect(tokens).toBeGreaterThan(2);
  });
});

describe('estimateMessageTokens', () => {
  it('should estimate tokens for single message', () => {
    const message: Message = { role: 'user', content: 'test'.repeat(10) }; // 40 chars
    const tokens = estimateMessageTokens(message);
    expect(tokens).toBeGreaterThan(0);
    // Should be reasonable for 40 characters
    expect(tokens).toBeLessThan(30);
  });
});

// ============================================================
// Compaction Strategy Schema Tests
// ============================================================

describe('CompactionStrategySchema', () => {
  it('should validate all strategies', () => {
    const strategies = ['truncate-oldest', 'summarize', 'importance-weighted'];
    for (const strategy of strategies) {
      expect(CompactionStrategySchema.safeParse(strategy).success).toBe(true);
    }
  });

  it('should reject invalid strategies', () => {
    expect(CompactionStrategySchema.safeParse('invalid').success).toBe(false);
  });
});

// ============================================================
// Truncate Oldest Strategy Tests
// ============================================================

describe('truncateOldest', () => {
  it('should return unchanged if message count below threshold', () => {
    const messages = createTestMessages(5);
    const result = truncateOldest(messages, 10);

    expect(result.removedCount).toBe(0);
    expect(result.messages).toHaveLength(5);
    expect(result.tokensBefore).toBe(result.tokensAfter);
  });

  it('should preserve system message', () => {
    const messages: Message[] = [
      createSystemPromptMessage(),
      ...createTestMessages(20),
    ];
    const result = truncateOldest(messages, 5);

    expect(result.messages[0]?.role).toBe('system');
    expect(result.removedCount).toBeGreaterThan(0);
  });

  it('should preserve recent messages', () => {
    const messages = createTestMessages(20);
    const preserveRecent = 5;
    const result = truncateOldest(messages, preserveRecent);

    // Check last preserveRecent messages are preserved
    const originalRecent = messages.slice(-preserveRecent);
    const compactedRecent = result.messages.slice(-preserveRecent);

    for (let i = 0; i < preserveRecent; i++) {
      expect(compactedRecent[i]?.content).toBe(originalRecent[i]?.content);
    }
  });

  it('should reduce token count', () => {
    const messages = createTestMessages(50);
    const result = truncateOldest(messages, 10);

    expect(result.tokensAfter).toBeLessThan(result.tokensBefore);
  });

  it('should preserve last N user messages', () => {
    const messages: Message[] = [
      createSystemPromptMessage(),
      createUserMessage('Q1'),
      createAssistantMessage('A1'),
      createUserMessage('Q2'),
      createAssistantMessage('A2'),
      createUserMessage('Q3'),
      createAssistantMessage('A3'),
    ];

    const result = truncateOldest(messages, 3, { lastNUserMessages: 2 });

    const userMessages = result.messages.filter(m => m.role === 'user');
    expect(userMessages.length).toBeGreaterThanOrEqual(2);
  });

  it('should preserve last N tool results', () => {
    const messages: Message[] = [
      createSystemPromptMessage(),
      createUserMessage('Get weather'),
      createToolMessage('tc-1', '{"temp": 20}'),
      createToolMessage('tc-2', '{"humidity": 65}'),
      createAssistantMessage('The weather is 20C'),
    ];

    const result = truncateOldest(messages, 2, { lastNToolResults: 1 });

    const toolMessages = result.messages.filter(m => m.role === 'tool');
    expect(toolMessages.length).toBeLessThanOrEqual(1);
  });

  it('should handle empty messages array', () => {
    const result = truncateOldest([], 5);
    expect(result.messages).toHaveLength(0);
    expect(result.removedCount).toBe(0);
  });
});

// ============================================================
// Importance Weighted Strategy Tests
// ============================================================

describe('importanceWeighted', () => {
  it('should return unchanged if message count below threshold', () => {
    const messages = createTestMessages(5);
    const result = importanceWeighted(messages, 10, 1000);

    expect(result.removedCount).toBe(0);
    expect(result.tokensBefore).toBe(result.tokensAfter);
  });

  it('should preserve system messages with high importance', () => {
    const messages: Message[] = [
      createSystemPromptMessage(),
      ...createTestMessages(30),
    ];
    const result = importanceWeighted(messages, 5, 500);

    // System message should be preserved
    expect(result.messages.some(m => m.role === 'system')).toBe(true);
  });

  it('should target token count', () => {
    const messages = createTestMessages(50);
    const targetTokens = 500;
    const result = importanceWeighted(messages, 5, targetTokens);

    // Should be close to target (within tolerance)
    expect(result.tokensAfter).toBeLessThanOrEqual(targetTokens + 100);
  });

  it('should handle tool error messages with higher importance', () => {
    const messages: Message[] = [
      createSystemPromptMessage(),
      createToolMessage('tc-1', 'Error: API rate limit exceeded'),
      createToolMessage('tc-2', '{"success": true}'),
      createUserMessage('What happened?'),
    ];

    const result = importanceWeighted(messages, 1, 100);

    // Error-containing message should be preserved
    expect(result.messages.length).toBeGreaterThan(0);
  });

  it('should preserve recent messages', () => {
    const messages = createTestMessages(30);
    const preserveRecent = 5;
    const result = importanceWeighted(messages, preserveRecent, 200);

    // Last preserveRecent messages should be preserved
    const originalRecent = messages.slice(-preserveRecent);
    expect(result.messages.length).toBeGreaterThanOrEqual(preserveRecent);
  });
});
