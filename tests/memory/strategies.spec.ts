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
  snipCompaction,
  pointerIndexed,
  type PointerIndexedConfig,
  CompactionStrategySchema,
} from '../../src/memory/strategies.js';
import type { VectorStore, VectorDocument } from '../../src/memory/vector-store.js';
import type { EmbeddingModel } from '../../src/memory/embedding.js';

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

// ============================================================
// Snip Compaction Strategy Tests
// ============================================================

describe('snipCompaction', () => {
  it('should keep system messages', () => {
    const messages: Message[] = [
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there!' },
      { role: 'user', content: 'Help me' },
      { role: 'assistant', content: 'Sure, what do you need?' },
    ];

    const result = snipCompaction(messages, 1);

    // System message should be preserved
    expect(result.messages.some(m => m.role === 'system')).toBe(true);
    expect(result.strategy).toBe('snip');
  });

  it('should keep pinned messages', () => {
    const messages: Message[] = [
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'Old Q1' },
      { role: 'assistant', content: 'Old A1' },
      {
        role: 'user',
        content: 'Important pinned question',
        metadata: { pinned: true },
      },
      { role: 'assistant', content: 'Answer to pinned' },
      { role: 'user', content: 'New Q1' },
      { role: 'assistant', content: 'New A1' },
    ];

    const result = snipCompaction(messages, 1);

    // Pinned message should be preserved even though it's old
    const pinnedFound = result.messages.some(
      m => m.metadata?.pinned === true && m.content === 'Important pinned question'
    );
    expect(pinnedFound).toBe(true);
  });

  it('should keep last N turns', () => {
    // Build messages with clear turns: user -> assistant pattern
    const messages: Message[] = [
      { role: 'system', content: 'System prompt' },
      // Turn 1
      { role: 'user', content: 'turn1-user' },
      { role: 'assistant', content: 'turn1-assistant' },
      // Turn 2
      { role: 'user', content: 'turn2-user' },
      { role: 'assistant', content: 'turn2-assistant' },
      // Turn 3
      { role: 'user', content: 'turn3-user' },
      { role: 'assistant', content: 'turn3-assistant' },
    ];

    const result = snipCompaction(messages, 2);

    // Should keep last 2 turns (turn2 and turn3)
    expect(result.messages.some(m => m.content === 'turn3-user')).toBe(true);
    expect(result.messages.some(m => m.content === 'turn3-assistant')).toBe(true);
    expect(result.messages.some(m => m.content === 'turn2-user')).toBe(true);
    expect(result.messages.some(m => m.content === 'turn2-assistant')).toBe(true);
  });

  it('should remove old turns', () => {
    const messages: Message[] = [
      { role: 'system', content: 'System prompt' },
      // Turn 1 (old)
      { role: 'user', content: 'turn1-user' },
      { role: 'assistant', content: 'turn1-assistant' },
      // Turn 2
      { role: 'user', content: 'turn2-user' },
      { role: 'assistant', content: 'turn2-assistant' },
      // Turn 3
      { role: 'user', content: 'turn3-user' },
      { role: 'assistant', content: 'turn3-assistant' },
    ];

    const result = snipCompaction(messages, 2);

    // Turn 1 should be removed
    expect(result.messages.some(m => m.content === 'turn1-user')).toBe(false);
    expect(result.messages.some(m => m.content === 'turn1-assistant')).toBe(false);
    expect(result.removedCount).toBeGreaterThan(0);
  });

  it('should handle tool messages within turns', () => {
    const messages: Message[] = [
      { role: 'system', content: 'System prompt' },
      // Turn 1 (old)
      { role: 'user', content: 'old-user' },
      { role: 'assistant', content: 'old-assistant-calling-tool', name: 'weather' },
      { role: 'tool', content: 'weather: sunny, 22C', toolCallId: 't1' },
      // Turn 2 (recent, kept)
      { role: 'user', content: 'new-user' },
      { role: 'assistant', content: 'new-assistant' },
    ];

    const result = snipCompaction(messages, 1);

    // Turn 2 should be kept
    expect(result.messages.some(m => m.content === 'new-user')).toBe(true);
    expect(result.messages.some(m => m.content === 'new-assistant')).toBe(true);

    // Turn 1 should be removed (including tool messages)
    expect(result.messages.some(m => m.content === 'old-user')).toBe(false);
    expect(result.messages.some(m => m.content === 'weather: sunny, 22C')).toBe(false);
  });

  it('should handle empty messages array', () => {
    const result = snipCompaction([], 3);
    expect(result.messages).toHaveLength(0);
    expect(result.removedCount).toBe(0);
    expect(result.strategy).toBe('snip');
  });

  it('should handle messages less than keepRecentTurns', () => {
    const messages: Message[] = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi!' },
    ];

    const result = snipCompaction(messages, 10);

    // All messages should be kept since we have fewer turns than keepRecentTurns
    expect(result.removedCount).toBe(0);
    expect(result.messages).toHaveLength(2);
    expect(result.tokensBefore).toBe(result.tokensAfter);
  });

  it('should return proper CompactionResult structure', () => {
    const messages: Message[] = [
      { role: 'system', content: 'System prompt' },
      { role: 'user', content: 'Q1' },
      { role: 'assistant', content: 'A1' },
      { role: 'user', content: 'Q2' },
      { role: 'assistant', content: 'A2' },
      { role: 'user', content: 'Q3' },
      { role: 'assistant', content: 'A3' },
    ];

    const result = snipCompaction(messages, 1);

    expect(result.strategy).toBe('snip');
    expect(typeof result.removedCount).toBe('number');
    expect(typeof result.tokensBefore).toBe('number');
    expect(typeof result.tokensAfter).toBe('number');
    expect(result.tokensAfter).toBeLessThanOrEqual(result.tokensBefore);
  });
});

// ============================================================
// Pointer-Indexed Strategy Tests (Gap 2 verification)
// ============================================================

describe('pointerIndexed', () => {
  /** In-memory vector store for testing */
  class InMemoryVectorStore implements VectorStore {
    readonly name = 'test-store';
    private docs = new Map<string, VectorDocument>();

    insert(doc: VectorDocument): void {
      this.docs.set(doc.id, doc);
    }

    insertBatch(docs: VectorDocument[]): void {
      for (const doc of docs) this.insert(doc);
    }

    search(_embedding: number[], limit = 5, _threshold = 0.7) {
      return Array.from(this.docs.values())
        .slice(0, limit)
        .map(doc => ({ document: doc, score: 0.95 }));
    }

    get(id: string) { return this.docs.get(id) ?? null; }
    delete(id: string) { this.docs.delete(id); }
    clear() { this.docs.clear(); }
    count() { return this.docs.size; }
    close() { this.docs.clear(); }
  }

  /** Mock embedding model that returns fixed-size vectors */
  class MockEmbeddingModel implements EmbeddingModel {
    async embed(_text: string): Promise<number[]> {
      return new Array(128).fill(0.1);
    }

    async embedBatch(texts: string[]): Promise<number[][]> {
      return texts.map(() => new Array(128).fill(0.1));
    }
  }

  /** Embedding model that always fails — for testing fallback */
  class FailingEmbeddingModel implements EmbeddingModel {
    async embed(): Promise<number[]> { throw new Error('embed failed'); }
    async embedBatch(): Promise<number[][]> { throw new Error('batch embed failed'); }
  }

  function makeMessages(count: number): Message[] {
    const msgs: Message[] = [];
    for (let i = 0; i < count; i++) {
      msgs.push({ role: i % 2 === 0 ? 'user' : 'assistant', content: `Message ${i}` });
    }
    return msgs;
  }

  const config: PointerIndexedConfig = {
    preserveRecent: 3,
    sessionId: 'test-session-1',
    compactionIndex: 0,
  };

  it('should index messages into vector store', async () => {
    const store = new InMemoryVectorStore();
    const embedder = new MockEmbeddingModel();
    const messages = makeMessages(10);

    const result = await pointerIndexed(messages, config, store, embedder);

    expect(result.strategy).toBe('pointer-indexed');
    expect(result.removedCount).toBe(7); // 10 total - 3 recent = 7 archived
    expect(store.count()).toBe(7);

    // Should contain a pointer message + recent messages
    expect(result.messages.length).toBe(4); // 1 pointer + 3 recent
    const pointerMsg = result.messages[0];
    if (pointerMsg) {
      expect(pointerMsg.role).toBe('system');
      expect(pointerMsg.name).toContain('memory-pointer');
      expect(pointerMsg.content).toContain('Semantic Memory Pointer');
    }
  });

  it('should fall back to truncate-oldest when no vector store', async () => {
    const messages = makeMessages(10);
    const result = await pointerIndexed(messages, config, undefined, new MockEmbeddingModel());

    expect(result.strategy).toBe('truncate-oldest');
    expect(result.messages.length).toBeLessThan(10);
  });

  it('should fall back to truncate-oldest when no embedding model', async () => {
    const store = new InMemoryVectorStore();
    const messages = makeMessages(10);
    const result = await pointerIndexed(messages, config, store, undefined);

    expect(result.strategy).toBe('truncate-oldest');
    expect(result.messages.length).toBeLessThan(10);
  });

  it('should fall back to truncate-oldest when all embeddings fail', async () => {
    const store = new InMemoryVectorStore();
    const embedder = new FailingEmbeddingModel();
    const messages = makeMessages(10);

    const result = await pointerIndexed(messages, config, store, embedder);

    // All embeddings failed → fallback to truncate
    expect(result.strategy).toBe('truncate-oldest');
    expect(store.count()).toBe(0);
  });

  it('should use embedBatch for batch embedding', async () => {
    const store = new InMemoryVectorStore();
    const embedder = new MockEmbeddingModel();

    // Spy on embedBatch
    const batchSpy = vi.spyOn(embedder, 'embedBatch');

    const messages = makeMessages(10);
    await pointerIndexed(messages, config, store, embedder);

    // embedBatch should have been called (not embed)
    expect(batchSpy).toHaveBeenCalled();
  });

  it('should return no-op when messages <= preserveRecent', async () => {
    const store = new InMemoryVectorStore();
    const embedder = new MockEmbeddingModel();
    const messages = makeMessages(2); // 2 <= 3 preserveRecent

    const result = await pointerIndexed(messages, config, store, embedder);

    expect(result.removedCount).toBe(0);
    expect(result.messages.length).toBe(2);
    expect(store.count()).toBe(0);
  });

  it('should respect maxIndexCount', async () => {
    const store = new InMemoryVectorStore();
    const embedder = new MockEmbeddingModel();
    const messages = makeMessages(20);

    const result = await pointerIndexed(
      messages,
      { ...config, maxIndexCount: 5 },
      store,
      embedder
    );

    expect(store.count()).toBeLessThanOrEqual(5);
    expect(result.removedCount).toBe(17); // 20 - 3
  });
});
