/**
 * Unit tests for src/operators/control.ts
 *
 * Tests control flow operators: retryOnEventType, timeoutOnEventType,
 * requirePermission, maxStepsLimit, pauseOnSignal.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  Observable,
  of,
  from,
  Subject,
  BehaviorSubject,
  firstValueFrom,
  toArray,
  delay,
  concatMap,
} from 'rxjs';
import {
  retryOnEventType,
  timeoutOnEventType,
  requirePermission,
  maxStepsLimit,
  pauseOnSignal,
} from '../../src/operators/control.js';
import { type AgentEvent, serializeError } from '../../src/core/index.js';

// ============================================================
// Test Helpers
// ============================================================

const baseEvent = { timestamp: Date.now(), sessionId: 'test-session' };

function createEventStream(events: AgentEvent[]): Observable<AgentEvent> {
  return from(events);
}

// ============================================================
// retryOnEventType Tests
// ============================================================

describe('retryOnEventType', () => {
  it('should pass through events when no error occurs', async () => {
    const events: AgentEvent[] = [
      { ...baseEvent, type: 'llm.request', messages: [], model: { provider: 'test', model: 'test' } },
      { ...baseEvent, type: 'llm.response', content: 'Hello', finishReason: 'stop' },
      { ...baseEvent, type: 'done', reason: 'stop' },
    ];

    const result = await firstValueFrom(
      createEventStream(events).pipe(
        retryOnEventType('llm.error', 3, 0),
        toArray()
      )
    );

    expect(result).toHaveLength(3);
    expect(result.map(e => e.type)).toEqual(['llm.request', 'llm.response', 'done']);
  });

  it('should convert error to agent.error event', async () => {
    const errorSource = new Observable<AgentEvent>(subscriber => {
      subscriber.next({ ...baseEvent, type: 'llm.request', messages: [], model: { provider: 'test', model: 'test' } });
      subscriber.error(new Error('LLM connection failed'));
    });

    const result = await firstValueFrom(
      errorSource.pipe(
        retryOnEventType('llm.error', 0, 0),
        toArray()
      )
    );

    expect(result.some(e => e.type === 'agent.error')).toBe(true);
    expect(result.some(e => e.type === 'done')).toBe(true);
  });

  it('should handle sync errors gracefully', async () => {
    const errorSource = new Observable<AgentEvent>(subscriber => {
      subscriber.error(new Error('Immediate error'));
    });

    const result = await firstValueFrom(
      errorSource.pipe(
        retryOnEventType('llm.error', 0, 0),
        toArray()
      )
    );

    expect(result).toHaveLength(2);
    expect(result[0]?.type).toBe('agent.error');
    expect(result[1]?.type).toBe('done');
  });
});

// ============================================================
// timeoutOnEventType Tests
// ============================================================

describe('timeoutOnEventType', () => {
  it('should pass through events when timeout is not exceeded', async () => {
    const events: AgentEvent[] = [
      { ...baseEvent, type: 'llm.request', messages: [], model: { provider: 'test', model: 'test' } },
      { ...baseEvent, type: 'llm.response', content: 'Hello', finishReason: 'stop' },
      { ...baseEvent, type: 'done', reason: 'stop' },
    ];

    const result = await firstValueFrom(
      createEventStream(events).pipe(
        timeoutOnEventType('llm.response', 5000),
        toArray()
      )
    );

    expect(result).toHaveLength(3);
  });

  it('should emit error event when timeout is exceeded', async () => {
    const slowSource = new Observable<AgentEvent>(subscriber => {
      // Start timeout timer
      subscriber.next({ ...baseEvent, type: 'llm.request', messages: [], model: { provider: 'test', model: 'test' } });
      // Don't emit llm.response - simulate timeout
      setTimeout(() => {
        // This would come after timeout
        subscriber.next({ ...baseEvent, type: 'llm.response', content: 'Late', finishReason: 'stop' });
        subscriber.complete();
      }, 150); // After timeout
    });

    const result = await firstValueFrom(
      slowSource.pipe(
        timeoutOnEventType('llm.response', 100),
        toArray()
      )
    );

    // Should emit agent.error and done before the late response
    expect(result.some(e => e.type === 'agent.error')).toBe(true);
    expect(result.some(e => e.type === 'done')).toBe(true);
  });

  it('should reset timeout when target event is received', async () => {
    const events: AgentEvent[] = [
      { ...baseEvent, type: 'llm.request', messages: [], model: { provider: 'test', model: 'test' } },
      { ...baseEvent, type: 'llm.response', content: 'Hello', finishReason: 'stop' },
      { ...baseEvent, type: 'llm.request', messages: [], model: { provider: 'test', model: 'test' } },
      { ...baseEvent, type: 'llm.response', content: 'World', finishReason: 'stop' },
      { ...baseEvent, type: 'done', reason: 'stop' },
    ];

    const result = await firstValueFrom(
      createEventStream(events).pipe(
        timeoutOnEventType('llm.response', 1000),
        toArray()
      )
    );

    expect(result).toHaveLength(5);
  });
});

// ============================================================
// requirePermission Tests
// ============================================================

describe('requirePermission', () => {
  it('should pass through non-tool.call events', async () => {
    const events: AgentEvent[] = [
      { ...baseEvent, type: 'llm.request', messages: [], model: { provider: 'test', model: 'test' } },
      { ...baseEvent, type: 'llm.response', content: 'Hello', finishReason: 'stop' },
      { ...baseEvent, type: 'done', reason: 'stop' },
    ];

    const result = await firstValueFrom(
      createEventStream(events).pipe(
        requirePermission(async () => false),
        toArray()
      )
    );

    expect(result).toHaveLength(3);
  });

  it('should allow tool.call when check returns true', async () => {
    const events: AgentEvent[] = [
      {
        ...baseEvent,
        type: 'tool.call',
        toolCallId: 'tc-1',
        toolName: 'safe_tool',
        args: {},
      },
    ];

    const result = await firstValueFrom(
      createEventStream(events).pipe(
        requirePermission(async () => true),
        toArray()
      )
    );

    expect(result).toHaveLength(1);
    expect(result[0]?.type).toBe('tool.call');
  });

  it('should deny tool.call when check returns false', async () => {
    const events: AgentEvent[] = [
      {
        ...baseEvent,
        type: 'tool.call',
        toolCallId: 'tc-1',
        toolName: 'dangerous_tool',
        args: {},
      },
    ];

    const result = await firstValueFrom(
      createEventStream(events).pipe(
        requirePermission(async () => false),
        toArray()
      )
    );

    expect(result.some(e => e.type === 'agent.error')).toBe(true);
    expect(result.some(e => e.type === 'done')).toBe(true);
  });

  it('should pass event details to check function', async () => {
    const capturedEvents: AgentEvent[] = [];

    const events: AgentEvent[] = [
      {
        ...baseEvent,
        type: 'tool.call',
        toolCallId: 'tc-1',
        toolName: 'weather',
        args: { city: 'Beijing' },
      },
    ];

    await firstValueFrom(
      createEventStream(events).pipe(
        requirePermission(async (event) => {
          capturedEvents.push(event);
          return true;
        }),
        toArray()
      )
    );

    expect(capturedEvents).toHaveLength(1);
    expect(capturedEvents[0]?.type).toBe('tool.call');
    if (capturedEvents[0]?.type === 'tool.call') {
      expect(capturedEvents[0].toolName).toBe('weather');
    }
  });

  it('should handle async check that throws', async () => {
    const events: AgentEvent[] = [
      {
        ...baseEvent,
        type: 'tool.call',
        toolCallId: 'tc-1',
        toolName: 'test',
        args: {},
      },
    ];

    const result = await firstValueFrom(
      createEventStream(events).pipe(
        requirePermission(async () => {
          throw new Error('Check failed');
        }),
        toArray()
      )
    );

    expect(result.some(e => e.type === 'agent.error')).toBe(true);
  });
});

// ============================================================
// maxStepsLimit Tests
// ============================================================

describe('maxStepsLimit', () => {
  it('should pass through events when step limit is not exceeded', async () => {
    const events: AgentEvent[] = [
      { ...baseEvent, type: 'agent.step', step: 1, maxSteps: 10 },
      { ...baseEvent, type: 'agent.step', step: 2, maxSteps: 10 },
      { ...baseEvent, type: 'agent.step', step: 3, maxSteps: 10 },
      { ...baseEvent, type: 'done', reason: 'stop' },
    ];

    const result = await firstValueFrom(
      createEventStream(events).pipe(
        maxStepsLimit(5),
        toArray()
      )
    );

    expect(result).toHaveLength(4);
  });

  it('should emit error when step limit is exceeded', async () => {
    const events: AgentEvent[] = [
      { ...baseEvent, type: 'agent.step', step: 1, maxSteps: 3 },
      { ...baseEvent, type: 'agent.step', step: 2, maxSteps: 3 },
      { ...baseEvent, type: 'agent.step', step: 3, maxSteps: 3 },
      { ...baseEvent, type: 'agent.step', step: 4, maxSteps: 3 }, // Exceeds limit of 3
      { ...baseEvent, type: 'done', reason: 'stop' },
    ];

    const result = await firstValueFrom(
      createEventStream(events).pipe(
        maxStepsLimit(3),
        toArray()
      )
    );

    // Should emit error at step 4, and stop
    expect(result.some(e => e.type === 'agent.error')).toBe(true);
    expect(result.some(e => e.type === 'done')).toBe(true);
    // Should not include events after the limit
    expect(result.filter(e => e.type === 'agent.step').length).toBeLessThanOrEqual(4);
  });

  it('should handle zero step limit', async () => {
    const events: AgentEvent[] = [
      { ...baseEvent, type: 'agent.step', step: 1, maxSteps: 10 },
    ];

    const result = await firstValueFrom(
      createEventStream(events).pipe(
        maxStepsLimit(0),
        toArray()
      )
    );

    // Step 1 > 0 should trigger limit
    expect(result.some(e => e.type === 'agent.error')).toBe(true);
  });

  it('should preserve step number in error event', async () => {
    const events: AgentEvent[] = [
      { ...baseEvent, type: 'agent.step', step: 5, maxSteps: 3 },
    ];

    const result = await firstValueFrom(
      createEventStream(events).pipe(
        maxStepsLimit(3),
        toArray()
      )
    );

    const errorEvent = result.find(e => e.type === 'agent.error');
    expect(errorEvent).toBeDefined();
    if (errorEvent?.type === 'agent.error') {
      expect(errorEvent.step).toBe(5);
    }
  });
});

// ============================================================
// pauseOnSignal Tests
// ============================================================

describe('pauseOnSignal', () => {
  it('should pass through events when not paused', async () => {
    const pauseSignal = new Subject<boolean>();
    pauseSignal.next(false); // Not paused

    const events: AgentEvent[] = [
      { ...baseEvent, type: 'llm.response', content: 'Hello', finishReason: 'stop' },
      { ...baseEvent, type: 'done', reason: 'stop' },
    ];

    const result = await firstValueFrom(
      createEventStream(events).pipe(
        pauseOnSignal(pauseSignal),
        toArray()
      )
    );

    expect(result).toHaveLength(2);
  });

  it('should buffer events when paused', async () => {
    const pauseSignal = new Subject<boolean>();

    const events: AgentEvent[] = [
      { ...baseEvent, type: 'llm.response', content: 'Hello', finishReason: 'stop' },
      { ...baseEvent, type: 'done', reason: 'stop' },
    ];

    // Create a controlled source
    const source = new Observable<AgentEvent>(subscriber => {
      // Emit first event
      subscriber.next(events[0]!);

      // Emit second event after delay
      setTimeout(() => {
        subscriber.next(events[1]!);
        subscriber.complete();
      }, 50);
    });

    const resultPromise = firstValueFrom(
      source.pipe(
        pauseOnSignal(pauseSignal),
        toArray()
      )
    );

    // Pause during the stream
    pauseSignal.next(true);

    // Resume after a short delay
    setTimeout(() => {
      pauseSignal.next(false);
    }, 30);

    const result = await resultPromise;

    // All events should eventually be emitted
    expect(result).toHaveLength(2);
  });

  it('should release buffered events on resume', async () => {
    const pauseSignal = new BehaviorSubject<boolean>(true); // Start paused
    const emitted: AgentEvent[] = [];

    const source = new Observable<AgentEvent>(subscriber => {
      subscriber.next({ ...baseEvent, type: 'llm.response', content: 'A', finishReason: 'stop' });
      subscriber.next({ ...baseEvent, type: 'llm.response', content: 'B', finishReason: 'stop' });
      subscriber.next({ ...baseEvent, type: 'done', reason: 'stop' });
      subscriber.complete();
    });

    const subscription = source.pipe(
      pauseOnSignal(pauseSignal)
    ).subscribe({
      next: event => emitted.push(event)
    });

    // Events should be buffered because we started paused
    expect(emitted).toHaveLength(0);

    // Resume
    pauseSignal.next(false);

    // Now all events should be emitted
    expect(emitted).toHaveLength(3);

    subscription.unsubscribe();
  });

  it('should handle multiple pause/resume cycles', async () => {
    const pauseSignal = new Subject<boolean>();
    const emitted: AgentEvent[] = [];

    const source = new Observable<AgentEvent>(subscriber => {
      let count = 0;
      const interval = setInterval(() => {
        count++;
        subscriber.next({ ...baseEvent, type: 'llm.response', content: `Event ${count}`, finishReason: 'stop' });
        if (count >= 4) {
          clearInterval(interval);
          subscriber.next({ ...baseEvent, type: 'done', reason: 'stop' });
          subscriber.complete();
        }
      }, 20);
    });

    const resultPromise = firstValueFrom(
      source.pipe(
        pauseOnSignal(pauseSignal),
        toArray()
      )
    );

    // Pause/resume cycle
    pauseSignal.next(true);
    await new Promise(resolve => setTimeout(resolve, 10));
    pauseSignal.next(false);
    await new Promise(resolve => setTimeout(resolve, 10));
    pauseSignal.next(true);
    await new Promise(resolve => setTimeout(resolve, 10));
    pauseSignal.next(false);

    const result = await resultPromise;

    // All events should eventually be emitted
    expect(result.length).toBeGreaterThanOrEqual(4);
    expect(result.some(e => e.type === 'done')).toBe(true);
  });

  it('should release buffered events on resume when source completes while paused', async () => {
    const pauseSignal = new BehaviorSubject<boolean>(true); // Start paused

    const events: AgentEvent[] = [
      { ...baseEvent, type: 'llm.response', content: 'Hello', finishReason: 'stop' },
      { ...baseEvent, type: 'done', reason: 'stop' },
    ];

    const resultPromise = firstValueFrom(
      createEventStream(events).pipe(
        pauseOnSignal(pauseSignal),
        toArray()
      )
    );

    // Give a moment for events to be buffered
    await new Promise(resolve => setTimeout(resolve, 10));

    // Resume to release buffered events
    pauseSignal.next(false);

    const result = await resultPromise;

    // After resume, all buffered events should be released
    expect(result).toHaveLength(2);
  });

  it('should handle error and release buffer', async () => {
    const pauseSignal = new BehaviorSubject<boolean>(true); // Start paused

    const errorSource = new Observable<AgentEvent>(subscriber => {
      subscriber.next({ ...baseEvent, type: 'llm.request', messages: [], model: { provider: 'test', model: 'test' } });
      subscriber.error(new Error('Test error'));
    });

    const result = await firstValueFrom(
      errorSource.pipe(
        pauseOnSignal(pauseSignal),
        toArray()
      )
    );

    // Should emit the buffered event, then error event, then done
    expect(result.length).toBeGreaterThan(0);
    expect(result.some(e => e.type === 'agent.error')).toBe(true);
    expect(result.some(e => e.type === 'done')).toBe(true);
  });
});

// ============================================================
// Edge Cases and Integration
// ============================================================

describe('Control Operators Integration', () => {
  it('should handle empty stream', async () => {
    const result = await firstValueFrom(
      of<AgentEvent>().pipe(
        maxStepsLimit(10),
        toArray()
      )
    );

    expect(result).toHaveLength(0);
  });

  it('should handle single terminal event', async () => {
    const events: AgentEvent[] = [
      { ...baseEvent, type: 'done', reason: 'stop' },
    ];

    const result = await firstValueFrom(
      createEventStream(events).pipe(
        maxStepsLimit(10),
        requirePermission(async () => true),
        toArray()
      )
    );

    expect(result).toHaveLength(1);
    expect(result[0]?.type).toBe('done');
  });

  it('should preserve event properties through operators', async () => {
    const originalEvent: AgentEvent = {
      type: 'llm.response',
      timestamp: 1234567890,
      sessionId: 'unique-session-123',
      content: 'Hello world',
      finishReason: 'stop',
      usage: { promptTokens: 100, completionTokens: 50 },
    };

    const result = await firstValueFrom(
      of(originalEvent).pipe(
        timeoutOnEventType('llm.response', 1000),
        toArray()
      )
    );

    expect(result[0]).toEqual(originalEvent);
  });
});
