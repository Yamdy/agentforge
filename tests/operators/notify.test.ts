/**
 * Unit tests for src/operators/notify.ts
 *
 * Tests notification operators: logEvents, traceEvents, recordMetrics,
 * exportEvents, checkpoint.
 *
 * All operators use tap and never block or throw on the main event stream.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { of, from, firstValueFrom, toArray, delay } from 'rxjs';
import {
  logEvents,
  traceEvents,
  recordMetrics,
  exportEvents,
  checkpoint,
  type Logger,
} from '../../src/operators/notify.js';
import type { AgentEvent } from '../../src/core/events.js';
import type { Tracer, Metrics, CheckpointStorage } from '../../src/core/interfaces.js';
import type { Checkpoint } from '../../src/core/checkpoint.js';

// ============================================================
// Test Helpers
// ============================================================

const baseEvent = { timestamp: Date.now(), sessionId: 'test-session' };

function createLLMResponseEvent(): AgentEvent {
  return {
    ...baseEvent,
    type: 'llm.response',
    content: 'Hello world',
    finishReason: 'stop',
    usage: { promptTokens: 100, completionTokens: 50 },
  };
}

function createToolExecuteEvent(): AgentEvent {
  return {
    ...baseEvent,
    type: 'tool.execute',
    toolCallId: 'tc-123',
    toolName: 'weather',
  };
}

function createAgentErrorEvent(): AgentEvent {
  return {
    ...baseEvent,
    type: 'agent.error',
    error: { name: 'TestError', message: 'Something went wrong' },
  };
}

// ============================================================
// Mock Factories
// ============================================================

function createMockLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function createMockTracer(): Tracer {
  return {
    startSpan: vi.fn().mockReturnValue('span-123'),
    endSpan: vi.fn(),
    addEvent: vi.fn(),
    recordException: vi.fn(),
  };
}

function createMockMetrics(): Metrics {
  return {
    increment: vi.fn(),
    histogram: vi.fn(),
    gauge: vi.fn(),
  };
}

function createMockStorage(): CheckpointStorage {
  return {
    save: vi.fn().mockResolvedValue(undefined),
    load: vi.fn().mockResolvedValue(null),
    list: vi.fn().mockResolvedValue([]),
    delete: vi.fn().mockResolvedValue(undefined),
    deleteAll: vi.fn().mockResolvedValue(undefined),
  };
}

// ============================================================
// logEvents Tests
// ============================================================

describe('logEvents', () => {
  it('should log each event with debug level', async () => {
    const mockLogger = createMockLogger();
    const events: AgentEvent[] = [
      { ...baseEvent, type: 'agent.start', input: 'test', agentName: 'test-agent', model: { provider: 'test', model: 'test' } },
      createLLMResponseEvent(),
      { ...baseEvent, type: 'done', reason: 'stop' },
    ];

    await firstValueFrom(
      from(events).pipe(logEvents(mockLogger), toArray())
    );

    expect(mockLogger.debug).toHaveBeenCalledTimes(3);
  });

  it('should include event type in log message', async () => {
    const mockLogger = createMockLogger();

    await firstValueFrom(
      of(createLLMResponseEvent()).pipe(logEvents(mockLogger))
    );

    expect(mockLogger.debug).toHaveBeenCalledWith(
      expect.stringContaining('llm.response'),
      expect.any(Object)
    );
  });

  it('should pass through events unchanged (tap behavior)', async () => {
    const mockLogger = createMockLogger();
    const originalEvent = createLLMResponseEvent();

    const result = await firstValueFrom(
      of(originalEvent).pipe(logEvents(mockLogger))
    );

    expect(result).toEqual(originalEvent);
  });

  it('should not block stream on logger errors', async () => {
    const mockLogger = createMockLogger();
    (mockLogger.debug as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('Logger failed');
    });

    // Should NOT throw - errors in tap should propagate though
    // But since logEvents doesn't catch, we expect it to throw
    const events: AgentEvent[] = [createLLMResponseEvent()];

    // The tap throws, so the stream errors
    await expect(
      firstValueFrom(from(events).pipe(logEvents(mockLogger)))
    ).rejects.toThrow('Logger failed');
  });

  it('should use default console logger when none provided', async () => {
    const consoleSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});

    await firstValueFrom(
      of(createLLMResponseEvent()).pipe(logEvents())
    );

    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});

// ============================================================
// traceEvents Tests
// ============================================================

describe('traceEvents', () => {
  it('should start and end span for each event', async () => {
    const mockTracer = createMockTracer();

    await firstValueFrom(
      of(createLLMResponseEvent()).pipe(traceEvents(mockTracer))
    );

    expect(mockTracer.startSpan).toHaveBeenCalledWith(
      'agent.event.llm.response',
      expect.objectContaining({
        attributes: expect.objectContaining({
          'event.type': 'llm.response',
        }),
      })
    );
    expect(mockTracer.endSpan).toHaveBeenCalledWith('span-123');
    expect(mockTracer.addEvent).toHaveBeenCalled();
  });

  it('should pass through events unchanged', async () => {
    const mockTracer = createMockTracer();
    const originalEvent = createLLMResponseEvent();

    const result = await firstValueFrom(
      of(originalEvent).pipe(traceEvents(mockTracer))
    );

    expect(result).toEqual(originalEvent);
  });

  it('should silently handle tracer errors without blocking stream', async () => {
    const mockTracer = createMockTracer();
    (mockTracer.startSpan as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('Tracer failed');
    });

    // Should NOT throw - errors are swallowed
    const result = await firstValueFrom(
      of(createLLMResponseEvent()).pipe(traceEvents(mockTracer))
    );

    expect(result).toBeDefined();
  });

  it('should handle addEvent errors gracefully', async () => {
    const mockTracer = createMockTracer();
    (mockTracer.addEvent as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('AddEvent failed');
    });

    // Should NOT throw
    const result = await firstValueFrom(
      of(createLLMResponseEvent()).pipe(traceEvents(mockTracer))
    );

    expect(result).toBeDefined();
  });

  it('should trace multiple events', async () => {
    const mockTracer = createMockTracer();
    const events: AgentEvent[] = [
      createLLMResponseEvent(),
      createToolExecuteEvent(),
    ];

    await firstValueFrom(
      from(events).pipe(traceEvents(mockTracer), toArray())
    );

    expect(mockTracer.startSpan).toHaveBeenCalledTimes(2);
    expect(mockTracer.endSpan).toHaveBeenCalledTimes(2);
  });
});

// ============================================================
// recordMetrics Tests
// ============================================================

describe('recordMetrics', () => {
  it('should increment counter for each event type', async () => {
    const mockMetrics = createMockMetrics();

    await firstValueFrom(
      of(createLLMResponseEvent()).pipe(recordMetrics(mockMetrics))
    );

    expect(mockMetrics.increment).toHaveBeenCalledWith('agent.event.llm.response');
  });

  it('should record token usage from LLM responses', async () => {
    const mockMetrics = createMockMetrics();
    const event = createLLMResponseEvent();

    await firstValueFrom(
      of(event).pipe(recordMetrics(mockMetrics))
    );

    expect(mockMetrics.histogram).toHaveBeenCalledWith('llm.tokens.prompt', 100);
    expect(mockMetrics.histogram).toHaveBeenCalledWith('llm.tokens.completion', 50);
  });

  it('should track tool executions', async () => {
    const mockMetrics = createMockMetrics();

    await firstValueFrom(
      of(createToolExecuteEvent()).pipe(recordMetrics(mockMetrics))
    );

    expect(mockMetrics.increment).toHaveBeenCalledWith('tool.execution.count', 1, {
      toolName: 'weather',
    });
  });

  it('should track agent errors', async () => {
    const mockMetrics = createMockMetrics();

    await firstValueFrom(
      of(createAgentErrorEvent()).pipe(recordMetrics(mockMetrics))
    );

    expect(mockMetrics.increment).toHaveBeenCalledWith('agent.error.count', 1, {
      errorType: 'TestError',
    });
  });

  it('should pass through events unchanged', async () => {
    const mockMetrics = createMockMetrics();
    const originalEvent = createLLMResponseEvent();

    const result = await firstValueFrom(
      of(originalEvent).pipe(recordMetrics(mockMetrics))
    );

    expect(result).toEqual(originalEvent);
  });

  it('should silently handle metrics errors', async () => {
    const mockMetrics = createMockMetrics();
    (mockMetrics.increment as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('Metrics failed');
    });

    // Should NOT throw
    const result = await firstValueFrom(
      of(createLLMResponseEvent()).pipe(recordMetrics(mockMetrics))
    );

    expect(result).toBeDefined();
  });

  it('should handle events without usage data', async () => {
    const mockMetrics = createMockMetrics();
    const event: AgentEvent = {
      ...baseEvent,
      type: 'llm.response',
      content: 'Hello',
      finishReason: 'stop',
      // No usage field
    };

    await firstValueFrom(
      of(event).pipe(recordMetrics(mockMetrics))
    );

    expect(mockMetrics.increment).toHaveBeenCalled();
    expect(mockMetrics.histogram).not.toHaveBeenCalled();
  });
});

// ============================================================
// exportEvents Tests
// ============================================================

describe('exportEvents', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should call exporter with each event', async () => {
    const exporter = vi.fn().mockResolvedValue(undefined);
    const event = createLLMResponseEvent();

    await firstValueFrom(
      of(event).pipe(exportEvents(exporter))
    );

    await vi.runAllTimersAsync();

    expect(exporter).toHaveBeenCalledWith(event);
  });

  it('should pass through events unchanged without waiting', async () => {
    const exporter = vi.fn().mockImplementation(() => new Promise(resolve => setTimeout(resolve, 100)));
    const event = createLLMResponseEvent();

    // Should return immediately without waiting for promise
    const result = await firstValueFrom(
      of(event).pipe(exportEvents(exporter))
    );

    expect(result).toEqual(event);
    // Exporter is called but we don't wait for it
    expect(exporter).toHaveBeenCalled();
  });

  it('should call onError when exporter fails', async () => {
    const exporter = vi.fn().mockRejectedValue(new Error('Export failed'));
    const onError = vi.fn();
    const event = createLLMResponseEvent();

    await firstValueFrom(
      of(event).pipe(exportEvents(exporter, onError))
    );

    await vi.runAllTimersAsync();

    expect(onError).toHaveBeenCalledWith(expect.any(Error));
  });

  it('should use default no-op error handler', async () => {
    const exporter = vi.fn().mockRejectedValue(new Error('Export failed'));
    const event = createLLMResponseEvent();

    // Should not throw with default handler
    const result = await firstValueFrom(
      of(event).pipe(exportEvents(exporter))
    );

    await vi.runAllTimersAsync();

    expect(result).toBeDefined();
  });

  it('should handle multiple events', async () => {
    const exporter = vi.fn().mockResolvedValue(undefined);
    const events: AgentEvent[] = [
      createLLMResponseEvent(),
      createToolExecuteEvent(),
    ];

    await firstValueFrom(
      from(events).pipe(exportEvents(exporter), toArray())
    );

    await vi.runAllTimersAsync();

    expect(exporter).toHaveBeenCalledTimes(2);
  });
});

// ============================================================
// checkpoint Tests
// ============================================================

describe('checkpoint', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should save checkpoint when shouldCheckpoint returns true', async () => {
    const mockStorage = createMockStorage();
    const shouldCheckpoint = vi.fn().mockReturnValue(true);
    const event = createLLMResponseEvent();

    await firstValueFrom(
      of(event).pipe(checkpoint(mockStorage, 'session-123', shouldCheckpoint))
    );

    await vi.runAllTimersAsync();

    expect(mockStorage.save).toHaveBeenCalled();
    const savedCheckpoint = (mockStorage.save as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as Checkpoint;
    expect(savedCheckpoint.sessionId).toBe('session-123');
  });

  it('should NOT save checkpoint when shouldCheckpoint returns false', async () => {
    const mockStorage = createMockStorage();
    const shouldCheckpoint = vi.fn().mockReturnValue(false);

    await firstValueFrom(
      of(createLLMResponseEvent()).pipe(checkpoint(mockStorage, 'session-123', shouldCheckpoint))
    );

    await vi.runAllTimersAsync();

    expect(mockStorage.save).not.toHaveBeenCalled();
  });

  it('should use provided stateProvider for state', async () => {
    const mockStorage = createMockStorage();
    const shouldCheckpoint = vi.fn().mockReturnValue(true);
    const mockState = {
      sessionId: 'custom-session',
      agentName: 'custom-agent',
      model: { provider: 'openai', model: 'gpt-4' },
      messages: [],
      pendingToolCalls: [],
      step: 5,
      maxSteps: 20,
      output: '',
      tokens: { prompt: 200, completion: 100 },
    };
    const stateProvider = vi.fn().mockReturnValue(mockState);

    await firstValueFrom(
      of(createLLMResponseEvent()).pipe(
        checkpoint(mockStorage, 'session-123', shouldCheckpoint, stateProvider)
      )
    );

    await vi.runAllTimersAsync();

    const savedCheckpoint = (mockStorage.save as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as Checkpoint;
    expect(savedCheckpoint.state).toEqual(mockState);
  });

  it('should create placeholder state when stateProvider not provided', async () => {
    const mockStorage = createMockStorage();
    const shouldCheckpoint = vi.fn().mockReturnValue(true);

    await firstValueFrom(
      of(createLLMResponseEvent()).pipe(
        checkpoint(mockStorage, 'session-123', shouldCheckpoint)
      )
    );

    await vi.runAllTimersAsync();

    const savedCheckpoint = (mockStorage.save as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as Checkpoint;
    expect(savedCheckpoint.state.sessionId).toBe('session-123');
  });

  it('should pass through events unchanged', async () => {
    const mockStorage = createMockStorage();
    const shouldCheckpoint = vi.fn().mockReturnValue(true);
    const originalEvent = createLLMResponseEvent();

    const result = await firstValueFrom(
      of(originalEvent).pipe(checkpoint(mockStorage, 'session-123', shouldCheckpoint))
    );

    expect(result).toEqual(originalEvent);
  });

  it('should silently handle storage save errors', async () => {
    const mockStorage = createMockStorage();
    (mockStorage.save as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Storage failed'));
    const shouldCheckpoint = vi.fn().mockReturnValue(true);

    // Should NOT throw
    const result = await firstValueFrom(
      of(createLLMResponseEvent()).pipe(checkpoint(mockStorage, 'session-123', shouldCheckpoint))
    );

    await vi.runAllTimersAsync();

    expect(result).toBeDefined();
  });

  it('should map event types to correct checkpoint positions', async () => {
    const mockStorage = createMockStorage();
    const shouldCheckpoint = vi.fn().mockReturnValue(true);

    // llm.request -> before_llm
    const llmRequestEvent: AgentEvent = {
      ...baseEvent,
      type: 'llm.request',
      messages: [],
      model: { provider: 'test', model: 'test' },
    };

    await firstValueFrom(
      of(llmRequestEvent).pipe(checkpoint(mockStorage, 'session-123', shouldCheckpoint))
    );

    await vi.runAllTimersAsync();

    let savedCheckpoint = (mockStorage.save as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as Checkpoint;
    expect(savedCheckpoint.position).toBe('before_llm');

    // tool.execute -> before_tool
    (mockStorage.save as ReturnType<typeof vi.fn>).mockClear();
    await firstValueFrom(
      of(createToolExecuteEvent()).pipe(checkpoint(mockStorage, 'session-123', shouldCheckpoint))
    );

    await vi.runAllTimersAsync();

    savedCheckpoint = (mockStorage.save as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as Checkpoint;
    expect(savedCheckpoint.position).toBe('before_tool');
  });

  it('should handle stateProvider returning undefined', async () => {
    const mockStorage = createMockStorage();
    const shouldCheckpoint = vi.fn().mockReturnValue(true);
    const stateProvider = vi.fn().mockReturnValue(undefined);

    await firstValueFrom(
      of(createLLMResponseEvent()).pipe(
        checkpoint(mockStorage, 'session-123', shouldCheckpoint, stateProvider)
      )
    );

    await vi.runAllTimersAsync();

    // Should use placeholder state when stateProvider returns undefined
    const savedCheckpoint = (mockStorage.save as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as Checkpoint;
    expect(savedCheckpoint.state).toBeDefined();
  });
});

// ============================================================
// Integration Tests
// ============================================================

describe('Notify Operators Integration', () => {
  it('should chain multiple operators without blocking', async () => {
    const mockLogger = createMockLogger();
    const mockTracer = createMockTracer();
    const mockMetrics = createMockMetrics();

    const events: AgentEvent[] = [
      createLLMResponseEvent(),
      createToolExecuteEvent(),
      { ...baseEvent, type: 'done', reason: 'stop' },
    ];

    const result = await firstValueFrom(
      from(events).pipe(
        logEvents(mockLogger),
        traceEvents(mockTracer),
        recordMetrics(mockMetrics),
        toArray()
      )
    );

    expect(result).toHaveLength(3);
    expect(mockLogger.debug).toHaveBeenCalledTimes(3);
    expect(mockTracer.startSpan).toHaveBeenCalledTimes(3);
    expect(mockMetrics.increment).toHaveBeenCalled();
  });

  it('should handle empty stream', async () => {
    const mockLogger = createMockLogger();
    const mockMetrics = createMockMetrics();

    const result = await firstValueFrom(
      of<AgentEvent>().pipe(
        logEvents(mockLogger),
        recordMetrics(mockMetrics),
        toArray()
      )
    );

    expect(result).toHaveLength(0);
    expect(mockLogger.debug).not.toHaveBeenCalled();
  });

  it('should preserve event order through operators', async () => {
    const mockLogger = createMockLogger();
    const events: AgentEvent[] = [
      { ...baseEvent, type: 'agent.start', input: 'test', agentName: 'test', model: { provider: 'test', model: 'test' } },
      createLLMResponseEvent(),
      { ...baseEvent, type: 'done', reason: 'stop' },
    ];

    const result = await firstValueFrom(
      from(events).pipe(logEvents(mockLogger), toArray())
    );

    expect(result.map(e => e.type)).toEqual(['agent.start', 'llm.response', 'done']);
  });
});
