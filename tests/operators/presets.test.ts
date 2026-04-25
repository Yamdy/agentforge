/**
 * Unit tests for src/operators/presets.ts
 *
 * Tests operator presets: productionPreset, debugPreset, testPreset, createPreset.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  Observable,
  of,
  from,
  Subject,
  firstValueFrom,
  toArray,
  delay,
} from 'rxjs';
import {
  productionPreset,
  debugPreset,
  testPreset,
  createPreset,
  type ProductionPresetConfig,
  type DebugPresetConfig,
  type TestPresetConfig,
} from '../../src/operators/presets.js';
import { type AgentEvent, type Tracer, type Metrics, type CheckpointStorage } from '../../src/core/index.js';
import { logEvents } from '../../src/operators/notify.js';

// ============================================================
// Test Helpers
// ============================================================

const baseEvent = { timestamp: Date.now(), sessionId: 'test-session' };

function createEventStream(events: AgentEvent[]): Observable<AgentEvent> {
  return from(events);
}

// Mock Tracer
function createMockTracer(): Tracer {
  return {
    startSpan: vi.fn(() => 'span-id'),
    endSpan: vi.fn(),
    addEvent: vi.fn(),
    recordException: vi.fn(),
  };
}

// Mock Metrics
function createMockMetrics(): Metrics {
  return {
    increment: vi.fn(),
    histogram: vi.fn(),
    gauge: vi.fn(),
  };
}

// Mock CheckpointStorage
function createMockCheckpointStorage(): CheckpointStorage {
  return {
    save: vi.fn(() => Promise.resolve()),
    load: vi.fn(() => Promise.resolve(null)),
    list: vi.fn(() => Promise.resolve([])),
    delete: vi.fn(() => Promise.resolve()),
    deleteAll: vi.fn(() => Promise.resolve()),
  };
}

// ============================================================
// productionPreset Tests
// ============================================================

describe('productionPreset', () => {
  let mockTracer: Tracer;
  let mockMetrics: Metrics;
  let mockStorage: CheckpointStorage;

  beforeEach(() => {
    mockTracer = createMockTracer();
    mockMetrics = createMockMetrics();
    mockStorage = createMockCheckpointStorage();
  });

  it('should pass through events', async () => {
    const events: AgentEvent[] = [
      { ...baseEvent, type: 'agent.start', input: 'Hello', agentName: 'test', model: { provider: 'test', model: 'test' } },
      { ...baseEvent, type: 'llm.response', content: 'World', finishReason: 'stop' },
      { ...baseEvent, type: 'done', reason: 'stop' },
    ];

    const config: ProductionPresetConfig = {
      tracer: mockTracer,
      metrics: mockMetrics,
      checkpointStorage: mockStorage,
      sessionId: 'test-session',
    };

    const result = await firstValueFrom(
      createEventStream(events).pipe(
        productionPreset(config),
        toArray()
      )
    );

    expect(result).toHaveLength(3);
    expect(result.map(e => e.type)).toEqual(['agent.start', 'llm.response', 'done']);
  });

  it('should use tracer for tracing events', async () => {
    const events: AgentEvent[] = [
      { ...baseEvent, type: 'agent.start', input: 'Hello', agentName: 'test', model: { provider: 'test', model: 'test' } },
      { ...baseEvent, type: 'done', reason: 'stop' },
    ];

    const config: ProductionPresetConfig = {
      tracer: mockTracer,
      metrics: mockMetrics,
      checkpointStorage: mockStorage,
      sessionId: 'test-session',
    };

    await firstValueFrom(
      createEventStream(events).pipe(
        productionPreset(config),
        toArray()
      )
    );

    // Tracer should be called for each event
    expect(mockTracer.startSpan).toHaveBeenCalled();
  });

  it('should use metrics for recording metrics', async () => {
    const events: AgentEvent[] = [
      { ...baseEvent, type: 'agent.start', input: 'Hello', agentName: 'test', model: { provider: 'test', model: 'test' } },
      { 
        ...baseEvent, 
        type: 'llm.response', 
        content: 'World', 
        finishReason: 'stop',
        usage: { promptTokens: 100, completionTokens: 50 },
      },
      { ...baseEvent, type: 'done', reason: 'stop' },
    ];

    const config: ProductionPresetConfig = {
      tracer: mockTracer,
      metrics: mockMetrics,
      checkpointStorage: mockStorage,
      sessionId: 'test-session',
    };

    await firstValueFrom(
      createEventStream(events).pipe(
        productionPreset(config),
        toArray()
      )
    );

    // Metrics should be incremented for each event
    expect(mockMetrics.increment).toHaveBeenCalled();
    // Should record token usage
    expect(mockMetrics.histogram).toHaveBeenCalledWith('llm.tokens.prompt', 100);
    expect(mockMetrics.histogram).toHaveBeenCalledWith('llm.tokens.completion', 50);
  });

  it('should save checkpoints for configured event types', async () => {
    const events: AgentEvent[] = [
      { ...baseEvent, type: 'llm.response', content: 'Hello', finishReason: 'stop' },
      { ...baseEvent, type: 'tool.result', toolCallId: 'tc-1', toolName: 'test', result: 'ok', isError: false },
      { ...baseEvent, type: 'done', reason: 'stop' },
    ];

    const config: ProductionPresetConfig = {
      tracer: mockTracer,
      metrics: mockMetrics,
      checkpointStorage: mockStorage,
      sessionId: 'test-session',
      checkpointEvents: ['llm.response', 'tool.result'],
    };

    await firstValueFrom(
      createEventStream(events).pipe(
        productionPreset(config),
        toArray()
      )
    );

    // Checkpoint should be saved for llm.response and tool.result
    expect(mockStorage.save).toHaveBeenCalledTimes(2);
  });

  it('should use default values when optional config is not provided', async () => {
    const events: AgentEvent[] = [
      { ...baseEvent, type: 'agent.start', input: 'Hello', agentName: 'test', model: { provider: 'test', model: 'test' } },
      { ...baseEvent, type: 'done', reason: 'stop' },
    ];

    const config: ProductionPresetConfig = {
      tracer: mockTracer,
      metrics: mockMetrics,
      checkpointStorage: mockStorage,
      sessionId: 'test-session',
    };

    // Should not throw with minimal config
    const result = await firstValueFrom(
      createEventStream(events).pipe(
        productionPreset(config),
        toArray()
      )
    );

    expect(result).toHaveLength(2);
  });
});

// ============================================================
// debugPreset Tests
// ============================================================

describe('debugPreset', () => {
  it('should log all events by default', async () => {
    const loggedMessages: Array<{ message: string; data?: unknown }> = [];

    const mockLogger = {
      debug: (message: string, data?: unknown) => loggedMessages.push({ message, data }),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    const events: AgentEvent[] = [
      { ...baseEvent, type: 'agent.start', input: 'Hello', agentName: 'test', model: { provider: 'test', model: 'test' } },
      { ...baseEvent, type: 'done', reason: 'stop' },
    ];

    await firstValueFrom(
      createEventStream(events).pipe(
        debugPreset(mockLogger),
        toArray()
      )
    );

    // All events should be logged
    expect(loggedMessages.length).toBeGreaterThanOrEqual(2);
  });

  it('should log completion', async () => {
    const infoMessages: string[] = [];

    const mockLogger = {
      debug: vi.fn(),
      info: (message: string) => infoMessages.push(message),
      warn: vi.fn(),
      error: vi.fn(),
    };

    const events: AgentEvent[] = [
      { ...baseEvent, type: 'done', reason: 'stop' },
    ];

    await firstValueFrom(
      createEventStream(events).pipe(
        debugPreset(mockLogger),
        toArray()
      )
    );

    expect(infoMessages.some(m => m.includes('complete'))).toBe(true);
  });

  it('should use console as default logger', async () => {
    const events: AgentEvent[] = [
      { ...baseEvent, type: 'done', reason: 'stop' },
    ];

    // Should not throw with no logger
    const result = await firstValueFrom(
      createEventStream(events).pipe(
        debugPreset(),
        toArray()
      )
    );

    expect(result).toHaveLength(1);
  });

  it('should accept config object', async () => {
    const loggedMessages: Array<{ message: string; data?: unknown }> = [];

    const mockLogger = {
      debug: (message: string, data?: unknown) => loggedMessages.push({ message, data }),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    const config: DebugPresetConfig = {
      logger: mockLogger,
      logAllEvents: true,
    };

    const events: AgentEvent[] = [
      { ...baseEvent, type: 'agent.start', input: 'Hello', agentName: 'test', model: { provider: 'test', model: 'test' } },
      { ...baseEvent, type: 'done', reason: 'stop' },
    ];

    await firstValueFrom(
      createEventStream(events).pipe(
        debugPreset(config),
        toArray()
      )
    );

    expect(loggedMessages.length).toBeGreaterThanOrEqual(2);
  });

  it('should log only specified types when logAllEvents is false', async () => {
    const loggedTypes: string[] = [];

    const mockLogger = {
      debug: (_message: string, data?: unknown) => {
        if (data && typeof data === 'object' && data !== null && 'type' in data) {
          loggedTypes.push((data as { type: string }).type);
        }
      },
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    const config: DebugPresetConfig = {
      logger: mockLogger,
      logAllEvents: false,
      alwaysLogTypes: ['done'],
    };

    const events: AgentEvent[] = [
      { ...baseEvent, type: 'agent.start', input: 'Hello', agentName: 'test', model: { provider: 'test', model: 'test' } },
      { ...baseEvent, type: 'llm.request', messages: [], model: { provider: 'test', model: 'test' } },
      { ...baseEvent, type: 'done', reason: 'stop' },
    ];

    await firstValueFrom(
      createEventStream(events).pipe(
        debugPreset(config),
        toArray()
      )
    );

    // Only 'done' should be logged since logAllEvents is false
    expect(loggedTypes).toContain('done');
  });
});

// ============================================================
// testPreset Tests
// ============================================================

describe('testPreset', () => {
  it('should collect events via onEvent callback', async () => {
    const collectedEvents: AgentEvent[] = [];

    const events: AgentEvent[] = [
      { ...baseEvent, type: 'agent.start', input: 'Hello', agentName: 'test', model: { provider: 'test', model: 'test' } },
      { ...baseEvent, type: 'done', reason: 'stop' },
    ];

    const config: TestPresetConfig = {
      onEvent: event => collectedEvents.push(event),
    };

    await firstValueFrom(
      createEventStream(events).pipe(
        testPreset(config),
        toArray()
      )
    );

    expect(collectedEvents).toHaveLength(2);
  });

  it('should call onTerminal for terminal events', async () => {
    const terminalEvents: AgentEvent[] = [];

    const events: AgentEvent[] = [
      { ...baseEvent, type: 'agent.start', input: 'Hello', agentName: 'test', model: { provider: 'test', model: 'test' } },
      { ...baseEvent, type: 'done', reason: 'stop' },
    ];

    const config: TestPresetConfig = {
      onTerminal: event => terminalEvents.push(event),
    };

    await firstValueFrom(
      createEventStream(events).pipe(
        testPreset(config),
        toArray()
      )
    );

    expect(terminalEvents).toHaveLength(1);
    expect(terminalEvents[0]?.type).toBe('done');
  });

  it('should log events when verbose is true', async () => {
    const consoleSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});

    const events: AgentEvent[] = [
      { ...baseEvent, type: 'agent.start', input: 'Hello', agentName: 'test', model: { provider: 'test', model: 'test' } },
      { ...baseEvent, type: 'done', reason: 'stop' },
    ];

    const config: TestPresetConfig = {
      verbose: true,
    };

    await firstValueFrom(
      createEventStream(events).pipe(
        testPreset(config),
        toArray()
      )
    );

    expect(consoleSpy).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it('should not log events when verbose is false', async () => {
    const consoleSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});

    const events: AgentEvent[] = [
      { ...baseEvent, type: 'agent.start', input: 'Hello', agentName: 'test', model: { provider: 'test', model: 'test' } },
      { ...baseEvent, type: 'done', reason: 'stop' },
    ];

    const config: TestPresetConfig = {
      verbose: false,
    };

    await firstValueFrom(
      createEventStream(events).pipe(
        testPreset(config),
        toArray()
      )
    );

    expect(consoleSpy).not.toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it('should work with empty config', async () => {
    const events: AgentEvent[] = [
      { ...baseEvent, type: 'done', reason: 'stop' },
    ];

    // Should not throw
    const result = await firstValueFrom(
      createEventStream(events).pipe(
        testPreset(),
        toArray()
      )
    );

    expect(result).toHaveLength(1);
  });

  it('should detect all terminal event types', async () => {
    const terminalEvents: AgentEvent[] = [];

    const events: AgentEvent[] = [
      { ...baseEvent, type: 'done', reason: 'stop' },
    ];

    const errorEvents: AgentEvent[] = [
      { ...baseEvent, type: 'agent.error', error: { name: 'Error', message: 'Test' } },
    ];

    const cancelEvents: AgentEvent[] = [
      { ...baseEvent, type: 'cancel', reason: 'user' },
    ];

    const config: TestPresetConfig = {
      onTerminal: event => terminalEvents.push(event),
    };

    // Test done
    await firstValueFrom(
      createEventStream(events).pipe(testPreset(config), toArray())
    );

    // Test agent.error
    await firstValueFrom(
      createEventStream(errorEvents).pipe(testPreset(config), toArray())
    );

    // Test cancel
    await firstValueFrom(
      createEventStream(cancelEvents).pipe(testPreset(config), toArray())
    );

    expect(terminalEvents).toHaveLength(3);
    expect(terminalEvents.map(e => e.type)).toContain('done');
    expect(terminalEvents.map(e => e.type)).toContain('agent.error');
    expect(terminalEvents.map(e => e.type)).toContain('cancel');
  });
});

// ============================================================
// createPreset Tests
// ============================================================

describe('createPreset', () => {
  it('should combine multiple operators', async () => {
    const collectedEvents: AgentEvent[] = [];

    const events: AgentEvent[] = [
      { ...baseEvent, type: 'agent.start', input: 'Hello', agentName: 'test', model: { provider: 'test', model: 'test' } },
      { ...baseEvent, type: 'done', reason: 'stop' },
    ];

    const myPreset = createPreset([
      // Log events
      logEvents({
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
      }),
    ]);

    const result = await firstValueFrom(
      createEventStream(events).pipe(
        myPreset,
        toArray()
      )
    );

    expect(result).toHaveLength(2);
  });

  it('should work with empty operators array', async () => {
    const events: AgentEvent[] = [
      { ...baseEvent, type: 'done', reason: 'stop' },
    ];

    const identityPreset = createPreset([]);

    const result = await firstValueFrom(
      createEventStream(events).pipe(
        identityPreset,
        toArray()
      )
    );

    expect(result).toHaveLength(1);
  });

  it('should apply operators in order', async () => {
    const order: string[] = [];

    const op1 = (source: Observable<AgentEvent>) =>
      new Observable<AgentEvent>(subscriber => {
        order.push('op1-start');
        return source.subscribe({
          next: v => subscriber.next(v),
          complete: () => {
            order.push('op1-complete');
            subscriber.complete();
          },
        });
      });

    const op2 = (source: Observable<AgentEvent>) =>
      new Observable<AgentEvent>(subscriber => {
        order.push('op2-start');
        return source.subscribe({
          next: v => subscriber.next(v),
          complete: () => {
            order.push('op2-complete');
            subscriber.complete();
          },
        });
      });

    const events: AgentEvent[] = [
      { ...baseEvent, type: 'done', reason: 'stop' },
    ];

    const myPreset = createPreset([op1, op2]);

    await firstValueFrom(
      createEventStream(events).pipe(
        myPreset,
        toArray()
      )
    );

    // Operators should be applied in order
    expect(order).toEqual(['op2-start', 'op1-start', 'op1-complete', 'op2-complete']);
  });
});

// ============================================================
// Integration Tests
// ============================================================

describe('Presets Integration', () => {
  it('should combine presets with other operators', async () => {
    const events: AgentEvent[] = [
      { ...baseEvent, type: 'agent.start', input: 'Hello', agentName: 'test', model: { provider: 'test', model: 'test' } },
      { ...baseEvent, type: 'done', reason: 'stop' },
    ];

    const result = await firstValueFrom(
      createEventStream(events).pipe(
        testPreset({ verbose: false }),
        toArray()
      )
    );

    expect(result).toHaveLength(2);
  });

  it('should handle empty stream', async () => {
    const result = await firstValueFrom(
      of<AgentEvent>().pipe(
        testPreset(),
        toArray()
      )
    );

    expect(result).toHaveLength(0);
  });

  it('should handle single event', async () => {
    const events: AgentEvent[] = [
      { ...baseEvent, type: 'done', reason: 'stop' },
    ];

    const result = await firstValueFrom(
      createEventStream(events).pipe(
        testPreset(),
        toArray()
      )
    );

    expect(result).toHaveLength(1);
    expect(result[0]?.type).toBe('done');
  });
});
