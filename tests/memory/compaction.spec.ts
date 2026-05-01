/**
 * Unit tests for src/memory/compaction.ts
 *
 * Tests CompactionManager, configuration, and event emission.
 */

import { describe, it, expect, vi } from 'vitest';
import type { Message } from '../../src/core/events.js';
import type { LLMAdapter, LLMResponse } from '../../src/core/interfaces.js';
import {
  CompactionManager,
  CompactionConfigSchema,
  CompactionContextSchema,
  DEFAULT_COMPACTION_CONFIG,
  createCompactionManager,
  createTruncateCompactionManager,
  createSummarizeCompactionManager,
  createDisabledCompactionManager,
} from '../../src/memory/compaction.js';

// ============================================================
// Test Helpers
// ============================================================

function createTestMessages(count: number): Message[] {
  const messages: Message[] = [
    { role: 'system', content: 'You are a helpful assistant.' },
  ];

  for (let i = 0; i < count; i++) {
    messages.push({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `Message ${i}: ${'x'.repeat(200)}`, // ~50 tokens each
    });
  }

  return messages;
}

function createMockLLMAdapter(summary: string): LLMAdapter {
  return {
    name: 'mock-llm',
    provider: 'mock',
    chat: vi.fn().mockResolvedValue({
      content: summary,
      finishReason: 'stop',
    } as LLMResponse),
    stream: vi.fn(),
  };
}

// ============================================================
// Schema Tests
// ============================================================

describe('CompactionConfigSchema', () => {
  it('should validate default config', () => {
    const result = CompactionConfigSchema.safeParse(DEFAULT_COMPACTION_CONFIG);
    expect(result.success).toBe(true);
  });

  it('should apply defaults for missing fields', () => {
    const result = CompactionConfigSchema.parse({});
    expect(result.enabled).toBe(true);
    expect(result.triggerThreshold).toBe(0.8);
    expect(result.strategy).toBe('truncate-oldest');
    expect(result.preserveRecent).toBe(10);
  });

  it('should reject invalid triggerThreshold', () => {
    expect(CompactionConfigSchema.safeParse({ triggerThreshold: 0.4 }).success).toBe(false);
    expect(CompactionConfigSchema.safeParse({ triggerThreshold: 1.0 }).success).toBe(false);
  });

  it('should reject invalid strategy', () => {
    expect(CompactionConfigSchema.safeParse({ strategy: 'invalid' }).success).toBe(false);
  });
});

describe('CompactionContextSchema', () => {
  it('should validate valid context', () => {
    const context = {
      sessionId: 'session-1',
      messages: [{ role: 'user' as const, content: 'Hello' }],
      currentTokenEstimate: 100,
      maxTokens: 1000,
    };
    expect(CompactionContextSchema.safeParse(context).success).toBe(true);
  });

  it('should reject missing required fields', () => {
    expect(CompactionContextSchema.safeParse({ sessionId: 's' }).success).toBe(false);
  });
});

// ============================================================
// CompactionManager Tests
// ============================================================

describe('CompactionManager', () => {
  describe('constructor', () => {
    it('should create with default config', () => {
      const manager = new CompactionManager();
      const config = manager.getConfig();
      expect(config.enabled).toBe(true);
      expect(config.strategy).toBe('truncate-oldest');
    });

    it('should merge provided config with defaults', () => {
      const manager = new CompactionManager({ preserveRecent: 20 });
      const config = manager.getConfig();
      expect(config.preserveRecent).toBe(20);
      expect(config.triggerThreshold).toBe(0.8); // default
    });

    it('should accept LLM adapter', () => {
      const llm = createMockLLMAdapter('Summary');
      const manager = new CompactionManager({}, llm);
      // Should not throw
      expect(manager).toBeDefined();
    });
  });

  describe('getConfig / updateConfig', () => {
    it('should return copy of config', () => {
      const manager = new CompactionManager();
      const config1 = manager.getConfig();
      const config2 = manager.getConfig();
      expect(config1).not.toBe(config2); // Different references
      expect(config1).toEqual(config2); // Same values
    });

    it('should update config', () => {
      const manager = new CompactionManager();
      manager.updateConfig({ preserveRecent: 50, triggerThreshold: 0.9 });
      const config = manager.getConfig();
      expect(config.preserveRecent).toBe(50);
      expect(config.triggerThreshold).toBe(0.9);
    });
  });

  describe('needsCompaction', () => {
    it('should return false when disabled', () => {
      const manager = new CompactionManager({ enabled: false });
      const context = {
        sessionId: 's1',
        messages: createTestMessages(100),
        currentTokenEstimate: 10000,
        maxTokens: 1000,
      };
      expect(manager.needsCompaction(context)).toBe(false);
    });

    it('should return false below threshold', () => {
      const manager = new CompactionManager({ triggerThreshold: 0.8 });
      const context = {
        sessionId: 's1',
        messages: [],
        currentTokenEstimate: 500,
        maxTokens: 1000,
      };
      expect(manager.needsCompaction(context)).toBe(false);
    });

    it('should return true at threshold', () => {
      const manager = new CompactionManager({ triggerThreshold: 0.8 });
      const context = {
        sessionId: 's1',
        messages: [],
        currentTokenEstimate: 800,
        maxTokens: 1000,
      };
      expect(manager.needsCompaction(context)).toBe(true);
    });

    it('should return true above threshold', () => {
      const manager = new CompactionManager({ triggerThreshold: 0.8 });
      const context = {
        sessionId: 's1',
        messages: [],
        currentTokenEstimate: 900,
        maxTokens: 1000,
      };
      expect(manager.needsCompaction(context)).toBe(true);
    });
  });

  describe('compact - truncate-oldest', () => {
    it('should compact messages', async () => {
      const manager = new CompactionManager({
        strategy: 'truncate-oldest',
        preserveRecent: 5,
      });
      const messages = createTestMessages(20);
      const context = {
        sessionId: 's1',
        messages,
        currentTokenEstimate: 5000,
        maxTokens: 4000,
      };

      const result = await manager.compact(context);

      expect(result.strategy).toBe('truncate-oldest');
      expect(result.removedCount).toBeGreaterThan(0);
      expect(result.tokensAfter).toBeLessThan(result.tokensBefore);
    });
  });

  describe('compact - summarize', () => {
    it('should fallback to truncate-oldest without LLM adapter', async () => {
      const manager = new CompactionManager({ strategy: 'summarize' });
      const messages = createTestMessages(20);
      const context = {
        sessionId: 's1',
        messages,
        currentTokenEstimate: 5000,
        maxTokens: 4000,
      };

      const result = await manager.compact(context);

      // Should fallback to truncate-oldest
      expect(result.strategy).toBe('truncate-oldest');
    });

    it('should summarize with LLM adapter', async () => {
      const llm = createMockLLMAdapter('This is a summary of the conversation.');
      const manager = new CompactionManager({ strategy: 'summarize' }, llm);
      const messages = createTestMessages(20);
      const context = {
        sessionId: 's1',
        messages,
        currentTokenEstimate: 5000,
        maxTokens: 4000,
      };

      const result = await manager.compact(context);

      expect(result.strategy).toBe('summarize');
      expect(result.summarizedCount).toBeGreaterThan(0);
      expect(result.summary).toBe('This is a summary of the conversation.');
    });

    it('should fallback on LLM error', async () => {
      const llm: LLMAdapter = {
        name: 'failing-llm',
        provider: 'mock',
        chat: vi.fn().mockRejectedValue(new Error('LLM failed')),
        stream: vi.fn(),
      };
      const manager = new CompactionManager({ strategy: 'summarize' }, llm);
      const messages = createTestMessages(20);
      const context = {
        sessionId: 's1',
        messages,
        currentTokenEstimate: 5000,
        maxTokens: 4000,
      };

      const result = await manager.compact(context);

      // Should fallback to truncate-oldest
      expect(result.strategy).toBe('truncate-oldest');
    });
  });

  describe('compact - importance-weighted', () => {
    it('should compact with importance weighting', async () => {
      const manager = new CompactionManager({
        strategy: 'importance-weighted',
        preserveRecent: 5,
        targetTokenRatio: 0.5,
      });
      const messages = createTestMessages(30);
      const context = {
        sessionId: 's1',
        messages,
        currentTokenEstimate: 5000,
        maxTokens: 2000,
      };

      const result = await manager.compact(context);

      expect(result.strategy).toBe('importance-weighted');
      // Should have removed some messages
      expect(result.removedCount).toBeGreaterThan(0);
    });
  });

  describe('events', () => {
    it('should emit compaction.start and compaction.complete events', async () => {
      const manager = new CompactionManager({ preserveRecent: 5 });
      const messages = createTestMessages(20);
      const context = {
        sessionId: 'test-session',
        messages,
        currentTokenEstimate: 5000,
        maxTokens: 4000,
      };

      // Collect events via callback
      const events: any[] = [];
      const unreg = manager.on((payload) => events.push(payload));

      const result = await manager.compact(context);

      unreg();
      expect(result).toBeDefined();
      expect(events.length).toBe(2); // start + complete
    });
  });

  describe('createContext', () => {
    it('should create valid context', () => {
      const manager = new CompactionManager();
      const messages = createTestMessages(10);
      const context = manager.createContext('session-1', messages, 4000);

      expect(context.sessionId).toBe('session-1');
      expect(context.maxTokens).toBe(4000);
      expect(context.currentTokenEstimate).toBeGreaterThan(0);
      expect(context.messages).toHaveLength(11); // 1 system + 10 messages
    });
  });

  describe('compactIfNeeded', () => {
    it('should return null when compaction not needed', async () => {
      const manager = new CompactionManager({ triggerThreshold: 0.8 });
      const messages = createTestMessages(5);
      
      const result = await manager.compactIfNeeded('session-1', messages, 10000);
      
      expect(result).toBeNull();
    });

    it('should compact when needed', async () => {
      const manager = new CompactionManager({
        triggerThreshold: 0.8,
        preserveRecent: 5,
      });
      const messages = createTestMessages(50);
      
      const result = await manager.compactIfNeeded('session-1', messages, 1000);
      
      expect(result).not.toBeNull();
      expect(result?.removedCount).toBeGreaterThan(0);
    });
  });
});

// ============================================================
// Factory Function Tests
// ============================================================

describe('Factory functions', () => {
  describe('createCompactionManager', () => {
    it('should create manager with defaults', () => {
      const manager = createCompactionManager();
      expect(manager.getConfig().strategy).toBe('truncate-oldest');
    });

    it('should accept LLM adapter', () => {
      const llm = createMockLLMAdapter('summary');
      const manager = createCompactionManager(llm);
      expect(manager).toBeDefined();
    });
  });

  describe('createTruncateCompactionManager', () => {
    it('should create manager with truncate-oldest strategy', () => {
      const manager = createTruncateCompactionManager(15);
      const config = manager.getConfig();
      expect(config.strategy).toBe('truncate-oldest');
      expect(config.preserveRecent).toBe(15);
    });

    it('should use default preserveRecent', () => {
      const manager = createTruncateCompactionManager();
      expect(manager.getConfig().preserveRecent).toBe(10);
    });
  });

  describe('createSummarizeCompactionManager', () => {
    it('should create manager with summarize strategy', () => {
      const llm = createMockLLMAdapter('summary');
      const manager = createSummarizeCompactionManager(llm);
      const config = manager.getConfig();
      expect(config.strategy).toBe('summarize');
    });

    it('should accept custom options', () => {
      const llm = createMockLLMAdapter('summary');
      const manager = createSummarizeCompactionManager(llm, 20, 800);
      const config = manager.getConfig();
      expect(config.preserveRecent).toBe(20);
      expect(config.maxSummaryLength).toBe(800);
    });
  });

  describe('createDisabledCompactionManager', () => {
    it('should create disabled manager', () => {
      const manager = createDisabledCompactionManager();
      expect(manager.getConfig().enabled).toBe(false);
    });

    it('should never need compaction', () => {
      const manager = createDisabledCompactionManager();
      const context = {
        sessionId: 's1',
        messages: createTestMessages(100),
        currentTokenEstimate: 100000,
        maxTokens: 1000,
      };
      expect(manager.needsCompaction(context)).toBe(false);
    });
  });

  // ── OffloadManager Integration ──

  describe('OffloadManager Integration', () => {
    function createMockOffloadManager() {
      return {
        offload: vi.fn().mockResolvedValue('/path/to/file.md'),
        load: vi.fn().mockResolvedValue(null),
      };
    }

    it('should accept offloadManager as third constructor parameter', () => {
      const offloadMgr = createMockOffloadManager();
      const manager = new CompactionManager({}, undefined, offloadMgr as any);
      expect(manager).toBeDefined();
    });

    it('should call offloadManager.offload() when messages are removed', async () => {
      const offloadMgr = createMockOffloadManager();
      const manager = new CompactionManager({ strategy: 'truncate-oldest', preserveRecent: 2 }, undefined, offloadMgr as any);
      const messages = createTestMessages(10);
      const result = await manager.compact({
        sessionId: 'test',
        messages,
        currentTokenEstimate: 5000,
        maxTokens: 2000,
      });
      expect(result.removedCount).toBeGreaterThan(0);
      expect(offloadMgr.offload).toHaveBeenCalled();
    });

    it('should NOT call offload() when no messages are removed', async () => {
      const offloadMgr = createMockOffloadManager();
      const manager = new CompactionManager({ strategy: 'truncate-oldest', preserveRecent: 100 }, undefined, offloadMgr as any);
      const messages = createTestMessages(5);
      await manager.compact({
        sessionId: 'test',
        messages,
        currentTokenEstimate: 1000,
        maxTokens: 100000,
      });
      // preserveRecent is 100, but only 5 messages exist — should not remove any
      expect(offloadMgr.offload).not.toHaveBeenCalled();
    });

    it('should NOT throw when offloadManager is undefined (backward compat)', async () => {
      const manager = new CompactionManager({ strategy: 'truncate-oldest', preserveRecent: 2 });
      const messages = createTestMessages(10);
      await expect(
        manager.compact({
          sessionId: 'test',
          messages,
          currentTokenEstimate: 5000,
          maxTokens: 2000,
        })
      ).resolves.toBeDefined();
    });

    it('should NOT throw when offloadManager.offload() fails', async () => {
      const failingOffload = {
        offload: vi.fn().mockRejectedValue(new Error('disk full')),
        load: vi.fn().mockResolvedValue(null),
      };
      const manager = new CompactionManager({ strategy: 'truncate-oldest', preserveRecent: 2 }, undefined, failingOffload as any);
      const messages = createTestMessages(10);
      // Should not throw even though offload fails
      const result = await manager.compact({
        sessionId: 'test',
        messages,
        currentTokenEstimate: 5000,
        maxTokens: 2000,
      });
      expect(result).toBeDefined();
      expect(result.removedCount).toBeGreaterThan(0);
      expect(failingOffload.offload).toHaveBeenCalled();
    });

    it('should createCompactionManager accept offloadManager', () => {
      const offloadMgr = createMockOffloadManager();
      const manager = createCompactionManager(undefined, offloadMgr as any);
      expect(manager).toBeDefined();
    });

    it('should createTruncateCompactionManager accept offloadManager', () => {
      const offloadMgr = createMockOffloadManager();
      const manager = createTruncateCompactionManager(10, offloadMgr as any);
      expect(manager).toBeDefined();
    });

    it('should createSummarizeCompactionManager accept offloadManager', () => {
      const llm = createMockLLMAdapter('summary');
      const offloadMgr = createMockOffloadManager();
      const manager = createSummarizeCompactionManager(llm, 10, 500, offloadMgr as any);
      expect(manager).toBeDefined();
    });
  });
});
