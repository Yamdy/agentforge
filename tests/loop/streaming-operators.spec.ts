/**
 * Phase 2c: Streaming + Operators Tests
 *
 * Tests for streaming LLM support and custom RxJS operators.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  Observable,
  of,
  from,
  Subject,
  firstValueFrom,
  toArray,
} from 'rxjs';
import { map, take } from 'rxjs/operators';
import {
  createAgentLoop,
  type AgentLoopConfig,
} from '../../src/loop/agent-loop.js';
import {
  type AgentContext,
  type AgentState,
  type AgentEvent,
  type ToolCall,
  type LLMResponse,
  type LLMAdapter,
  type LLMChunk,
  type ToolDefinition,
  type ToolRegistry,
  InMemoryStore,
  DefaultPauseController,
  SimpleSchemaRegistry,
} from '../../src/core/index.js';
import {
  filterEventType,
  filterEventTypePrefix,
  takeUntilTerminal,
  tapEvent,
  tapEvents,
  collectMetrics,
  groupByStep,
  dedupeEventTypes,
  eventToString,
  type AgentMetrics,
} from '../../src/operators/index.js';

// ============================================================
// Mock LLM with Streaming
// ============================================================

class MockStreamingLLMAdapter implements LLMAdapter {
  private responses: LLMResponse[] = [];
  private streamingChunks: LLMChunk[][] = [];
  private callCount = 0;
  private useStreaming = false;

  setResponses(responses: LLMResponse[]): void {
    this.responses = responses;
    this.callCount = 0;
  }

  setStreamingChunks(chunks: LLMChunk[][]): void {
    this.streamingChunks = chunks;
    this.useStreaming = true;
  }

  async chat(_messages: AgentState['messages']): Promise<LLMResponse> {
    this.callCount++;
    if (this.callCount <= this.responses.length) {
      return this.responses[this.callCount - 1]!;
    }
    return { content: 'Default response', finishReason: 'stop' };
  }

  stream(_messages: AgentState['messages']): Observable<LLMChunk> {
    this.callCount++;
    const chunks = this.streamingChunks.length > 0
      ? this.streamingChunks[this.callCount - 1] ?? []
      : [];
    return from(chunks);
  }

  getCallCount(): number {
    return this.callCount;
  }
}

// ============================================================
// Mock Tool Registry (reused from agent-loop.spec.ts)
// ============================================================

class MockToolRegistry implements ToolRegistry {
  private tools = new Map<string, ToolDefinition>();

  register(name: string, executor: (args: Record<string, unknown>) => Promise<string>): void {
    this.tools.set(name, {
      name,
      description: `Tool: ${name}`,
      parameters: {},
      execute: executor,
    });
  }

  list(): string[] { return Array.from(this.tools.keys()); }
  has(name: string): boolean { return this.tools.has(name); }
  get(name: string): ToolDefinition | undefined { return this.tools.get(name); }
  getFunctionDef(name: string) {
    const tool = this.tools.get(name);
    return tool ? { name: tool.name, description: tool.description, parameters: { type: 'object' as const, properties: {} } } : undefined;
  }
  getFunctionDefs() { return this.list().map(n => this.getFunctionDef(n)!); }
  async execute(name: string, args: Record<string, unknown>, _ctx?: unknown): Promise<string> {
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`Tool "${name}" not found`);
    return tool.execute(args);
  }
  registerAll(_tools: ToolDefinition[]): void {}
}

// ============================================================
// Helpers
// ============================================================

function createTestContext(llm: MockStreamingLLMAdapter, toolRegistry: MockToolRegistry): AgentContext {
  return {
    sessionId: `test-streaming-${Date.now()}`,
    agentName: 'test-agent',
    memory: new InMemoryStore(),
    pauseController: new DefaultPauseController(),
    services: {
      schemaRegistry: new SimpleSchemaRegistry(),
      llmFactory: { create: () => llm },
      toolRegistry,
    },
    llm,
    tools: toolRegistry,
  };
}

function createTestConfig(overrides: Partial<AgentLoopConfig> = {}): AgentLoopConfig {
  return {
    model: { provider: 'mock', model: 'test-model' },
    maxSteps: 10,
    maxLLMRepairAttempts: 3,
    parallelToolCalls: true,
    ...overrides,
  };
}

// ============================================================
// Streaming Tests
// ============================================================

describe('Phase 2c: Streaming LLM', () => {
  let llm: MockStreamingLLMAdapter;
  let toolRegistry: MockToolRegistry;

  beforeEach(() => {
    llm = new MockStreamingLLMAdapter();
    toolRegistry = new MockToolRegistry();

    toolRegistry.register('weather', async (args) => {
      return JSON.stringify({ city: args.city, temp: 25 });
    });
  });

  it('should emit streaming events for text response', async () => {
    llm.setStreamingChunks([
      [
        { text: 'Hello' },
        { text: ' world' },
        { text: '!' },
      ],
    ]);

    const ctx = createTestContext(llm, toolRegistry);
    const config = createTestConfig({ streaming: true });

    const agent = createAgentLoop(ctx, config);
    const events = await firstValueFrom(agent.run('Hi').pipe(toArray()));

    const types = events.map(e => e.type);

    // Should have streaming events
    expect(types).toContain('llm.stream.start');
    expect(types.filter(t => t === 'llm.stream.text')).toHaveLength(3);
    expect(types).toContain('llm.stream.end');

    // Should still have llm.response with accumulated content
    const response = events.find(e => e.type === 'llm.response');
    expect(response).toBeDefined();
    if (response?.type === 'llm.response') {
      expect(response.content).toBe('Hello world!');
      expect(response.finishReason).toBe('stop');
    }

    // Should complete normally
    expect(types).toContain('agent.complete');
    expect(types).toContain('done');
  });

  it('should emit streaming tool_call events', async () => {
    llm.setStreamingChunks([
      [
        { text: '' },
        { toolCallId: 'tc-1', toolName: 'weather', argsDelta: '{"city":' },
        { toolCallId: 'tc-1', toolName: 'weather', argsDelta: ' "Beijing"}' },
      ],
    ]);

    // Need a second LLM response for after tool execution
    llm.setResponses([
      { content: 'The weather is sunny!', finishReason: 'stop' },
    ]);

    const ctx = createTestContext(llm, toolRegistry);
    const config = createTestConfig({ streaming: true, parallelToolCalls: false });

    const agent = createAgentLoop(ctx, config);
    const events = await firstValueFrom(agent.run('Get weather').pipe(toArray()));

    const types = events.map(e => e.type);

    // Should have streaming tool_call events
    expect(types).toContain('llm.stream.tool_call');

    // Should have tool execution events
    expect(types).toContain('tool.execute');
    expect(types).toContain('tool.result');

    // Should complete
    expect(types).toContain('agent.complete');
  });

  it('should handle streaming errors gracefully', async () => {
    // Create an LLM that throws on stream
    const errorLlm = new MockStreamingLLMAdapter();
    const errorCtx = createTestContext(errorLlm, toolRegistry);
    const errorConfig = createTestConfig({ streaming: true });

    // Override stream to throw
    const originalStream = errorLlm.stream.bind(errorLlm);
    errorLlm.stream = (_messages: AgentState['messages']) => {
      return new Observable<LLMChunk>(subscriber => {
        subscriber.next({ text: 'Starting...' });
        subscriber.error(new Error('Stream interrupted'));
      });
    };

    const agent = createAgentLoop(errorCtx, errorConfig);
    const events = await firstValueFrom(agent.run('Hello').pipe(toArray()));

    // Should emit some stream text then error
    expect(events.find(e => e.type === 'llm.stream.text')).toBeDefined();
    expect(events.find(e => e.type === 'agent.error')).toBeDefined();
  });
});

// ============================================================
// Operators Tests
// ============================================================

describe('Phase 2c: Custom RxJS Operators', () => {
  // Helper to create event stream
  function createEventStream(events: AgentEvent[]): Observable<AgentEvent> {
    return from(events);
  }

  const baseEvent = { timestamp: Date.now(), sessionId: 'test' };

  // ========================================
  // filterEventType
  // ========================================
  describe('filterEventType', () => {
    it('should filter events by exact type', async () => {
      const events: AgentEvent[] = [
        { ...baseEvent, type: 'llm.response', content: 'Hello', finishReason: 'stop' },
        { ...baseEvent, type: 'done', reason: 'stop' },
        { ...baseEvent, type: 'llm.response', content: 'World', finishReason: 'stop' },
      ];

      const result = await firstValueFrom(
        createEventStream(events).pipe(filterEventType('llm.response'), toArray()),
      );

      expect(result).toHaveLength(2);
      expect(result.every(e => e.type === 'llm.response')).toBe(true);
    });
  });

  // ========================================
  // filterEventTypePrefix
  // ========================================
  describe('filterEventTypePrefix', () => {
    it('should filter events by type prefix', async () => {
      const events: AgentEvent[] = [
        { ...baseEvent, type: 'llm.request', messages: [], model: { provider: 'test', model: 'test' } },
        { ...baseEvent, type: 'llm.response', content: 'Hi', finishReason: 'stop' },
        { ...baseEvent, type: 'tool.execute', toolCallId: 'tc-1', toolName: 'test' },
        { ...baseEvent, type: 'done', reason: 'stop' },
      ];

      const result = await firstValueFrom(
        createEventStream(events).pipe(filterEventTypePrefix('llm.'), toArray()),
      );

      expect(result).toHaveLength(2);
      expect(result.every(e => e.type.startsWith('llm.'))).toBe(true);
    });
  });

  // ========================================
  // takeUntilTerminal
  // ========================================
  describe('takeUntilTerminal', () => {
    it('should complete on terminal event', async () => {
      const events: AgentEvent[] = [
        { ...baseEvent, type: 'llm.response', content: 'Hi', finishReason: 'stop' },
        { ...baseEvent, type: 'done', reason: 'stop' },
        { ...baseEvent, type: 'llm.response', content: 'Should not appear', finishReason: 'stop' },
      ];

      const result = await firstValueFrom(
        createEventStream(events).pipe(takeUntilTerminal(), toArray()),
      );

      // Should include events up to and including the terminal event
      expect(result.length).toBeLessThanOrEqual(2);
      expect(result.some(e => e.type === 'done')).toBe(true);
    });
  });

  // ========================================
  // tapEvent
  // ========================================
  describe('tapEvent', () => {
    it('should call handler for matching event type', async () => {
      const tapped: string[] = [];

      const events: AgentEvent[] = [
        { ...baseEvent, type: 'llm.response', content: 'Hello', finishReason: 'stop' },
        { ...baseEvent, type: 'done', reason: 'stop' },
      ];

      await firstValueFrom(
        createEventStream(events).pipe(
          tapEvent('llm.response', e => tapped.push(e.content)),
          toArray(),
        ),
      );

      expect(tapped).toEqual(['Hello']);
    });

    it('should not call handler for non-matching events', async () => {
      const tapped: string[] = [];

      const events: AgentEvent[] = [
        { ...baseEvent, type: 'llm.response', content: 'Hello', finishReason: 'stop' },
        { ...baseEvent, type: 'done', reason: 'stop' },
      ];

      await firstValueFrom(
        createEventStream(events).pipe(
          tapEvent('tool.result', () => tapped.push('called')),
          toArray(),
        ),
      );

      expect(tapped).toEqual([]);
    });
  });

  // ========================================
  // tapEvents
  // ========================================
  describe('tapEvents', () => {
    it('should call handlers for multiple event types', async () => {
      const log: string[] = [];

      const events: AgentEvent[] = [
        { ...baseEvent, type: 'llm.response', content: 'Hello', finishReason: 'stop' },
        { ...baseEvent, type: 'done', reason: 'stop' },
      ];

      await firstValueFrom(
        createEventStream(events).pipe(
          tapEvents({
            'llm.response': e => log.push(`response: ${e.content}`),
            'done': e => log.push(`done: ${e.reason}`),
          }),
          toArray(),
        ),
      );

      expect(log).toEqual(['response: Hello', 'done: stop']);
    });
  });

  // ========================================
  // collectMetrics
  // ========================================
  describe('collectMetrics', () => {
    it('should collect metrics from event stream', async () => {
      let collectedMetrics: AgentMetrics | null = null;

      const events: AgentEvent[] = [
        {
          ...baseEvent,
          type: 'llm.request',
          messages: [],
          model: { provider: 'test', model: 'test' },
        },
        {
          ...baseEvent,
          type: 'llm.response',
          content: 'Hello',
          finishReason: 'stop',
          usage: { promptTokens: 100, completionTokens: 50 },
        },
        { ...baseEvent, type: 'done', reason: 'stop' },
      ];

      await firstValueFrom(
        createEventStream(events).pipe(
          collectMetrics(metrics => { collectedMetrics = metrics; }),
          toArray(),
        ),
      );

      expect(collectedMetrics).not.toBeNull();
      expect(collectedMetrics!.totalEvents).toBe(3);
      expect(collectedMetrics!.llmCalls).toBe(1);
      expect(collectedMetrics!.promptTokens).toBe(100);
      expect(collectedMetrics!.completionTokens).toBe(50);
      expect(collectedMetrics!.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  // ========================================
  // groupByStep
  // ========================================
  describe('groupByStep', () => {
    it('should group events into arrays', async () => {
      const events: AgentEvent[] = [
        { ...baseEvent, type: 'llm.response', content: 'Hello', finishReason: 'stop' },
        { ...baseEvent, type: 'done', reason: 'stop' },
      ];

      const groups = await firstValueFrom(
        createEventStream(events).pipe(groupByStep(), toArray()),
      );

      expect(groups).toHaveLength(1);
      expect(groups[0]).toHaveLength(2);
    });
  });

  // ========================================
  // dedupeEventTypes
  // ========================================
  describe('dedupeEventTypes', () => {
    it('should deduplicate events of same type within window', async () => {
      const events: AgentEvent[] = [
        { ...baseEvent, type: 'llm.stream.text', delta: 'a' },
        { ...baseEvent, type: 'llm.stream.text', delta: 'b' },
        { ...baseEvent, type: 'llm.stream.text', delta: 'c' },
      ];

      const result = await firstValueFrom(
        createEventStream(events).pipe(dedupeEventTypes(0), toArray()),
      );

      // With 0ms window, only first event of each type should pass
      expect(result).toHaveLength(1);
    });

    it('should allow events of same type outside window', async () => {
      // Use setTimeout to create actual time delays between events
      const event1: AgentEvent = { ...baseEvent, type: 'llm.stream.text', delta: 'a' };
      const event2: AgentEvent = { ...baseEvent, type: 'llm.stream.text', delta: 'b' };

      // Create a stream with a 10ms delay between events, and a 5ms dedupe window
      // The second event should pass because it arrives after the 5ms window
      const delayedStream = new Observable<AgentEvent>(subscriber => {
        subscriber.next(event1);
        setTimeout(() => {
          subscriber.next(event2);
          subscriber.complete();
        }, 15); // 15ms delay, larger than window
      });

      const result = await firstValueFrom(
        delayedStream.pipe(dedupeEventTypes(5), toArray()),
      );

      expect(result).toHaveLength(2);
    });
  });

  // ========================================
  // eventToString
  // ========================================
  describe('eventToString', () => {
    it('should convert events to string representation', async () => {
      const events: AgentEvent[] = [
        { ...baseEvent, type: 'llm.response', content: 'Hello world', finishReason: 'stop' },
        { ...baseEvent, type: 'done', reason: 'stop' },
      ];

      const strings = await firstValueFrom(
        createEventStream(events).pipe(eventToString(), toArray()),
      );

      expect(strings).toHaveLength(2);
      expect(strings[0]).toContain('llm.response');
      expect(strings[1]).toContain('done');
    });
  });
});
