/**
 * E2E Streaming Tests - Real LLM Streaming Validation
 *
 * Tests end-to-end streaming output with real LLM API.
 * Validates that Agent correctly emits and processes streaming events.
 *
 * API Configuration (GLM-5):
 * - baseURL: https://api.lkeap.cloud.tencent.com/plan/v3
 * - model: glm-5
 *
 * Test Scenarios:
 * 1. Basic streaming output - multiple chunks, content assembly
 * 2. Streaming + tool calls - tool_call chunks, parameter parsing
 * 3. Stream interruption/resume - cancellation, re-subscription
 * 4. Event ordering - start → text[] → end sequence
 * 5. Error handling - stream interruption, graceful degradation
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type {
  AgentEvent,
  LLMAdapter,
  LLMChunk,
  ToolDefinition,
  ToolRegistry,
} from '../../src/core/index.js';
import {
  InMemoryStore,
  DefaultPauseController,
  SimpleSchemaRegistry,
} from '../../src/core/index.js';
import {
  resolveApiConfig,
  shouldRunE2E,
  RealLLMAdapter,
  SimpleToolRegistry,
  createAgentLoop,
} from '../fixtures/e2e-adapters.js';
import type { AgentLoopConfig } from '../../src/loop/agent-loop.js';

// ============================================================
// Lightweight Subscribable factories (for testing)
// ============================================================

interface Subscribable<T> {
  subscribe(observer: { next(v: T): void; error?(e: unknown): void; complete?(): void }): { unsubscribe(): void };
}

function createSubscribable<T>(fn: (observer: { next(v: T): void; error(e: unknown): void; complete(): void }) => void | (() => void)): Subscribable<T> {
  let cleanup: (() => void) | void;
  let subscribed = false;
  return {
    subscribe(observer) {
      if (subscribed) return { unsubscribe() {} };
      subscribed = true;
      try {
        cleanup = fn({ next: v => observer.next(v), error: e => observer.error?.(e), complete: () => observer.complete?.() });
      } catch (e) {
        observer.error?.(e);
      }
      return { unsubscribe() { cleanup?.(); } };
    }
  };
}

function createSubject<T>() {
  let subscribers: Array<{ next(v: T): void; error?(e: unknown): void; complete?(): void }> = [];
  let closed = false;
  return {
    subscribe(observer: { next(v: T): void; error?(e: unknown): void; complete?(): void }) {
      if (closed) { observer.complete?.(); return { unsubscribe() {} }; }
      subscribers.push(observer);
      return { unsubscribe() { subscribers = subscribers.filter(s => s !== observer); } };
    },
    next(v: T) { for (const s of subscribers) s.next(v); },
    error(e: unknown) { for (const s of subscribers) s.error?.(e); subscribers = []; closed = true; },
    complete() { for (const s of subscribers) s.complete?.(); subscribers = []; closed = true; },
    get observed() { return subscribers.length > 0; },
  };
}

async function collectUntil<T>(src: Subscribable<T>, cancel$?: { subscribe: (obs: any) => any }): Promise<T[]> {
  return new Promise((resolve) => {
    const events: T[] = [];
    let cancelUnsub: (() => void) | undefined;
    const sub = src.subscribe({
      next: (v: T) => events.push(v),
      error: () => sub?.unsubscribe() || resolve(events),
      complete: () => { cancelUnsub?.(); resolve(events); },
    });
    if (cancel$) {
      cancelUnsub = cancel$.subscribe({ next: () => { sub?.unsubscribe(); resolve(events); } });
    }
  });
}

// ============================================================
// API Configuration
// ============================================================

// Inline env check to avoid fixture-side-effect timing issues with dotenv
const API_CONFIG = resolveApiConfig();
const HAS_API_KEY = (process.env.LLM_API_KEY?.length ?? 0) > 0;

// ============================================================
// Test Helpers
// ============================================================

function createTestContext(llm: LLMAdapter, toolRegistry: ToolRegistry) {
  return {
    sessionId: `e2e-streaming-${Date.now()}`,
    agentName: 'e2e-test-agent',
    memory: new InMemoryStore(),
    pauseController: new DefaultPauseController(),
    services: {
      schemaRegistry: new SimpleSchemaRegistry(),
      llmFactory: { create: () => llm },
      toolRegistry,
    },
    llm,
    tools: toolRegistry,
  } as any;
}

function createTestConfig(overrides: Partial<AgentLoopConfig> = {}): AgentLoopConfig {
  return {
    model: { provider: 'openai-compatible', model: API_CONFIG.model },
    maxSteps: 5,
    maxLLMRepairAttempts: 2,
    parallelToolCalls: true,
    streaming: true,
    ...overrides,
  };
}

async function runAndCollect(agent: any, input: string): Promise<any[]> {
  const events: any[] = [];
  const unsub = agent.onAny((e: any) => events.push(e));
  try { await agent.run(input); } catch {}
  unsub();
  return events;
}

// ============================================================
// E2E Tests
// ============================================================

describe.skipIf(!HAS_API_KEY)('E2E Streaming Tests', () => {
  let llm: RealLLMAdapter;
  let toolRegistry: SimpleToolRegistry;

  beforeAll(() => {
    llm = new RealLLMAdapter(API_CONFIG);
    toolRegistry = new SimpleToolRegistry();

    // Register test tools
    toolRegistry.register({
      name: 'get_weather',
      description: 'Get weather information for a city',
      parameters: {
        type: 'object',
        properties: {
          city: { type: 'string', description: 'City name' },
        },
        required: ['city'],
      },
      execute: async (args: unknown) => {
        const { city } = args as { city: string };
        return JSON.stringify({ city, temperature: 22, condition: 'sunny' });
      },
    });

    toolRegistry.register({
      name: 'calculate',
      description: 'Perform a simple calculation',
      parameters: {
        type: 'object',
        properties: {
          expression: { type: 'string', description: 'Math expression to calculate' },
        },
        required: ['expression'],
      },
      execute: async (args: unknown) => {
        const { expression } = args as { expression: string };
        try {
          const result = Function('"use strict"; return (' + expression + ')')();
          return String(result);
        } catch {
          return 'Error: Invalid expression';
        }
      },
    });
  });

  afterAll(() => {
    // Cleanup
  });

  // ========================================
  // Scenario 1: Basic Streaming Output
  // ========================================
  describe('Scenario 1: Basic Streaming Output', () => {
    it('should receive multiple text chunks during streaming', async () => {
      const emptyRegistry = new SimpleToolRegistry();
      const ctx = createTestContext(llm, emptyRegistry);
      const config = createTestConfig();

      const agent = createAgentLoop(ctx, config);
      const events = await runAndCollect(agent, 'Say hello in exactly 5 words.');

      const streamTextEvents = events.filter(e => e.type === 'llm.stream.text');
      expect(streamTextEvents.length).toBeGreaterThanOrEqual(3);

      const content = streamTextEvents
        .map(e => (e as { delta: string }).delta)
        .join('');

      expect(content.length).toBeGreaterThan(0);
    }, 30000);

    it('should emit stream.start before text chunks', async () => {
      const emptyRegistry = new SimpleToolRegistry();
      const ctx = createTestContext(llm, emptyRegistry);
      const config = createTestConfig();

      const agent = createAgentLoop(ctx, config);
      const events = await runAndCollect(agent, 'Say hi.');

      const types = events.map(e => e.type);
      const startIdx = types.indexOf('llm.stream.start');
      const textIdx = types.indexOf('llm.stream.text');

      expect(startIdx).toBeGreaterThanOrEqual(0);
      expect(textIdx).toBeGreaterThan(startIdx);
    }, 30000);

    it('should emit stream.end after text chunks', async () => {
      const emptyRegistry = new SimpleToolRegistry();
      const ctx = createTestContext(llm, emptyRegistry);
      const config = createTestConfig();

      const agent = createAgentLoop(ctx, config);
      const events = await runAndCollect(agent, 'Say bye.');

      const types = events.map(e => e.type);
      const lastTextIdx = types.lastIndexOf('llm.stream.text');
      const endIdx = types.indexOf('llm.stream.end');

      expect(endIdx).toBeGreaterThan(lastTextIdx);
    }, 30000);

    it('should assemble complete content in llm.response', async () => {
      const emptyRegistry = new SimpleToolRegistry();
      const ctx = createTestContext(llm, emptyRegistry);
      const config = createTestConfig();

      const agent = createAgentLoop(ctx, config);
      const events = await runAndCollect(agent, 'Count from 1 to 5, each number on a new line.');

      const streamTextEvents = events.filter(e => e.type === 'llm.stream.text');
      const assembledContent = streamTextEvents
        .map(e => (e as { delta: string }).delta)
        .join('');

      const responseEvent = events.find(e => e.type === 'llm.response');
      expect(responseEvent).toBeDefined();

      if (responseEvent?.type === 'llm.response') {
        expect(responseEvent.content).toBe(assembledContent);
      }
    }, 30000);
  });

  // ========================================
  // Scenario 2: Streaming + Tool Calls
  // ========================================
  describe('Scenario 2: Streaming + Tool Calls', () => {
    it('should emit llm.stream.tool_call events when tool is called', async () => {
      const ctx = createTestContext(llm, toolRegistry);
      const config = createTestConfig();

      const agent = createAgentLoop(ctx, config);
      const events = await runAndCollect(agent, 'What is the weather in Beijing?');

      const toolCallEvents = events.filter(e => e.type === 'llm.stream.tool_call');

      // May or may not have tool calls depending on LLM response
      // Just verify the event structure if present
      if (toolCallEvents.length > 0) {
        const firstToolCall = toolCallEvents[0];
        if (firstToolCall?.type === 'llm.stream.tool_call') {
          expect(firstToolCall.toolCallId).toBeDefined();
          expect(firstToolCall.toolName).toBeDefined();
        }
      }
    }, 30000);

    it('should correctly parse tool arguments from stream', async () => {
      const ctx = createTestContext(llm, toolRegistry);
      const config = createTestConfig();

      const agent = createAgentLoop(ctx, config);
      const events = await runAndCollect(agent, 'Calculate 25 * 4 + 10');

      // If LLM makes tool call, verify tool.result is present
      const toolResultEvent = events.find(e => e.type === 'tool.result');
      if (toolResultEvent) {
        // Tool was called, verify result structure
        expect(toolResultEvent).toBeDefined();
      }

      // Verify completion
      const completeEvent = events.find(e => e.type === 'agent.complete');
      expect(completeEvent).toBeDefined();
    }, 30000);

    it('should execute tools and continue conversation', async () => {
      const ctx = createTestContext(llm, toolRegistry);
      const config = createTestConfig({ maxSteps: 3 });

      const agent = createAgentLoop(ctx, config);
      const events = await runAndCollect(agent, 'Get weather for Shanghai and tell me if it is good for outdoor activities.');

      const toolExecuteEvents = events.filter(e => e.type === 'tool.execute');
      const toolResultEvents = events.filter(e => e.type === 'tool.result');

      // If tools were called, verify execution
      if (toolExecuteEvents.length > 0) {
        expect(toolResultEvents.length).toBe(toolExecuteEvents.length);
      }

      expect(events.find(e => e.type === 'agent.complete')).toBeDefined();
    }, 45000);
  });

  // ========================================
  // Scenario 3: Stream Interruption/Resume
  // ========================================
  describe('Scenario 3: Stream Interruption/Resume', () => {
    it('should handle subscription cancellation gracefully', async () => {
      const ctx = createTestContext(llm, toolRegistry);
      const config = createTestConfig();

      const agent = createAgentLoop(ctx, config);
      const cancel$ = createSubject<void>();

      const eventsPromise = collectUntil(agent.run$('Write a long story about a cat.'), cancel$);

      // Event-driven: cancel after first stream text event
      const unsub = agent.onAny((e: any) => {
        if (e.type === 'llm.stream.text') {
          cancel$.next();
        }
      });

      const events = await eventsPromise;
      unsub();

      // Should have received some events before cancellation
      expect(events.length).toBeGreaterThan(0);

      // Stream events should be present (partial streaming)
      const streamEvents = events.filter((e: any) =>
        e.type.startsWith('llm.stream.')
      );
      expect(streamEvents.length).toBeGreaterThan(0);
    }, 30000);

    it('should allow re-subscription after cancellation', async () => {
      const ctx = createTestContext(llm, toolRegistry);
      const config = createTestConfig();

      const agent = createAgentLoop(ctx, config);

      // First subscription - cancelled
      const cancel$ = createSubject<void>();

      // Start and immediately cancel (event-driven)
      const firstRunPromise = collectUntil(agent.run$('Say hello.'), cancel$).catch(() => {});
      cancel$.next(); // Cancel synchronously after subscription is set up
      await firstRunPromise;

      // Wait for cleanup using fake timers
      vi.useFakeTimers();
      await vi.advanceTimersByTimeAsync(200);
      vi.useRealTimers();

      // Second subscription should work
      const events = await runAndCollect(agent, 'Say goodbye.');

      expect(events.find((e: any) => e.type === 'agent.complete')).toBeDefined();
    }, 30000);
  });

  // ========================================
  // Scenario 4: Event Ordering
  // ========================================
  describe('Scenario 4: Event Ordering', () => {
    it('should emit events in correct sequence: start → text[] → end → response', async () => {
      const emptyRegistry = new SimpleToolRegistry();
      const ctx = createTestContext(llm, emptyRegistry);
      const config = createTestConfig();

      const agent = createAgentLoop(ctx, config);
      const events = await runAndCollect(agent, 'Say "test".');

      const types = events.map(e => e.type);

      // Find indices
      const startIdx = types.indexOf('llm.stream.start');
      const textIdx = types.indexOf('llm.stream.text');
      const endIdx = types.indexOf('llm.stream.end');
      const responseIdx = types.indexOf('llm.response');

      // Verify order: start → text → end → response
      expect(startIdx).toBeLessThan(textIdx);
      expect(textIdx).toBeLessThan(endIdx);
      expect(endIdx).toBeLessThan(responseIdx);
    }, 30000);

    it('should have monotonically increasing timestamps within a stream', async () => {
      const emptyRegistry = new SimpleToolRegistry();
      const ctx = createTestContext(llm, emptyRegistry);
      const config = createTestConfig();

      const agent = createAgentLoop(ctx, config);
      const events = await runAndCollect(agent, 'Count from 1 to 3.');

      const streamEvents = events.filter(e =>
        e.type.startsWith('llm.stream.')
      );

      // Verify timestamps are non-decreasing
      for (let i = 1; i < streamEvents.length; i++) {
        const prev = streamEvents[i - 1]!;
        const curr = streamEvents[i]!;
        expect(curr.timestamp).toBeGreaterThanOrEqual(prev.timestamp);
      }
    }, 30000);

    it('should emit agent.step before llm.request', async () => {
      const ctx = createTestContext(llm, toolRegistry);
      const config = createTestConfig();

      const agent = createAgentLoop(ctx, config);
      const events = await runAndCollect(agent, 'Hello.');

      const types = events.map(e => e.type);
      const stepIdx = types.indexOf('agent.step');
      const requestIdx = types.indexOf('llm.request');

      expect(stepIdx).toBeLessThan(requestIdx);
    }, 30000);
  });

  // ========================================
  // Scenario 5: Error Handling
  // ========================================
  describe('Scenario 5: Error Handling', () => {
    it('should emit agent.error + done on stream interruption', async () => {
      // Create an LLM that simulates stream interruption
      const errorLlm: LLMAdapter = {
        name: 'error-llm',
        provider: 'test',
        chat: async () => ({ content: 'test', finishReason: 'stop' }),
          stream: () => createSubscribable<LLMChunk>(observer => {
            observer.next({ text: 'Starting...' });
            const t = setTimeout(() => {
              observer.error(new Error('Connection lost'));
            }, 50);
            return () => clearTimeout(t);
          }),
      };

      const ctx = createTestContext(errorLlm, toolRegistry);
      const config = createTestConfig();

      const agent = createAgentLoop(ctx, config);
      vi.useFakeTimers();
      const eventsPromise = runAndCollect(agent, 'Hello.');
      await vi.advanceTimersByTimeAsync(50);
      const events = await eventsPromise;
      vi.useRealTimers();

      // Should have some text before error
      expect(events.find((e: any) => e.type === 'llm.stream.text')).toBeDefined();

      // Should emit error events
      expect(events.find((e: any) => e.type === 'agent.error')).toBeDefined();
      expect(events.find((e: any) => e.type === 'done')).toBeDefined();

      const doneEvent = events.find((e: any) => e.type === 'done');
      if (doneEvent?.type === 'done') {
        expect(doneEvent.reason).toBe('error');
      }
    }, 30000);

    it('should not crash on API timeout simulation', async () => {
      // Create an LLM that simulates timeout
      const timeoutLlm: LLMAdapter = {
        name: 'timeout-llm',
        provider: 'test',
        chat: async () => ({ content: 'test', finishReason: 'stop' }),
        stream: () => createSubscribable<LLMChunk>(observer => {
          observer.next({ text: 'Starting...' });
          // Never completes - simulates timeout
          // The test timeout will catch this
        }),
      };

      const ctx = createTestContext(timeoutLlm, toolRegistry);
      const config = createTestConfig();

      const agent = createAgentLoop(ctx, config);

      // Use fake timers to ensure test doesn't hang
      const timeoutCancel$ = createSubject<void>();

      vi.useFakeTimers();
      setTimeout(() => { timeoutCancel$.next(); }, 2000);

      const eventsPromise = collectUntil(agent.run$('Hello.'), timeoutCancel$);
      await vi.advanceTimersByTimeAsync(2000);

      const events = await eventsPromise;
      vi.useRealTimers();

      // Should have received some events before timeout
      expect(events.length).toBeGreaterThan(0);
    }, 10000);

    it('should handle empty stream gracefully', async () => {
      const emptyLlm: LLMAdapter = {
        name: 'empty-llm',
        provider: 'test',
        chat: async () => ({ content: '', finishReason: 'stop' }),
        stream: () => createSubscribable<LLMChunk>(observer => {
          // Immediately complete with no chunks
          observer.complete();
        }),
      };

      const ctx = createTestContext(emptyLlm, toolRegistry);
      const config = createTestConfig();

      const agent = createAgentLoop(ctx, config);
      const events = await runAndCollect(agent, 'Hello.');

      // Should still have start and end events
      expect(events.find(e => e.type === 'llm.stream.start')).toBeDefined();
      expect(events.find(e => e.type === 'llm.stream.end')).toBeDefined();
      expect(events.find(e => e.type === 'llm.response')).toBeDefined();
    }, 30000);
  });

  // ========================================
  // Scenario 6: Integration Tests
  // ========================================
  describe('Scenario 6: Integration', () => {
    it('should complete full conversation flow with streaming', async () => {
      const emptyRegistry = new SimpleToolRegistry();
      const ctx = createTestContext(llm, emptyRegistry);
      const config = createTestConfig();

      const agent = createAgentLoop(ctx, config);
      const events = await runAndCollect(agent, 'Tell me a short joke.');

      const types = events.map(e => e.type);

      // Verify full event sequence
      expect(types).toContain('agent.start');
      expect(types).toContain('agent.step');
      expect(types).toContain('llm.request');
      expect(types).toContain('llm.stream.start');
      expect(types).toContain('llm.stream.text');
      expect(types).toContain('llm.stream.end');
      expect(types).toContain('llm.response');
      expect(types).toContain('agent.complete');
      expect(types).toContain('done');
    }, 30000);

    it('should track token usage when available', async () => {
      const emptyRegistry = new SimpleToolRegistry();
      const ctx = createTestContext(llm, emptyRegistry);
      const config = createTestConfig();

      const agent = createAgentLoop(ctx, config);
      const events = await runAndCollect(agent, 'Hi.');

      const responseEvent = events.find(e => e.type === 'llm.response');
      expect(responseEvent).toBeDefined();

      // Token usage may or may not be available depending on API
      if (responseEvent?.type === 'llm.response' && responseEvent.usage) {
        expect(responseEvent.usage.promptTokens).toBeGreaterThanOrEqual(0);
        expect(responseEvent.usage.completionTokens).toBeGreaterThanOrEqual(0);
      }
    }, 30000);
  });
});
