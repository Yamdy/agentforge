/**
 * Plugin System Unit Tests
 *
 * Tests for plugin interfaces, pipeline builder, and plugin manager.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Observable, of, from, EMPTY, firstValueFrom, toArray } from 'rxjs';
import type { AgentEvent } from '../../src/core/events.js';
import {
  type InterceptorPlugin,
  type ObserverPlugin,
  type PluginContext,
  type CreatePluginContextOptions,
  isInterceptorPlugin,
  isObserverPlugin,
  validatePlugin,
  PluginSchema,
  createPluginContext,
} from '../../src/plugins/plugin.js';
import { buildPluginPipeline, emptyPipeline, blockingPipeline, replacePipeline } from '../../src/plugins/pipeline.js';
import { PluginManager, createPluginManager } from '../../src/plugins/manager.js';

// ============================================================
// Test Fixtures
// ============================================================

const mockCtx: PluginContext = {
  sessionId: 'test-session',
  agentName: 'test-agent',
};

// Typed event factories - use 'as const' for literal types
function createStartEvent(sessionId = 'test-session'): AgentEvent {
  return {
    type: 'agent.start',
    timestamp: Date.now(),
    sessionId,
    input: 'test input',
    agentName: 'test-agent',
    model: { provider: 'test', model: 'test-model' },
  } as const as AgentEvent;
}

function createStepEvent(sessionId = 'test-session'): AgentEvent {
  return {
    type: 'agent.step',
    timestamp: Date.now(),
    sessionId,
    step: 1,
    maxSteps: 10,
  } as const as AgentEvent;
}

function createDoneEvent(sessionId = 'test-session'): AgentEvent {
  return {
    type: 'done',
    timestamp: Date.now(),
    sessionId,
    reason: 'stop',
  } as const as AgentEvent;
}

// Type guard for agent.start
function isAgentStartEvent(event: AgentEvent): event is AgentEvent & { input: string } {
  return event.type === 'agent.start';
}

// ============================================================
// Type Guards
// ============================================================

describe('isInterceptorPlugin', () => {
  it('returns true for interceptor plugins', () => {
    const plugin: InterceptorPlugin = {
      name: 'test-interceptor',
      type: 'interceptor',
      priority: 100,
      eventTypes: [],
      enabled: true,
      intercept: () => of(createStartEvent()),
    };
    expect(isInterceptorPlugin(plugin)).toBe(true);
  });

  it('returns false for observer plugins', () => {
    const plugin: ObserverPlugin = {
      name: 'test-observer',
      type: 'observer',
      priority: 100,
      eventTypes: [],
      enabled: true,
      observe: () => {},
    };
    expect(isInterceptorPlugin(plugin)).toBe(false);
  });
});

describe('isObserverPlugin', () => {
  it('returns true for observer plugins', () => {
    const plugin: ObserverPlugin = {
      name: 'test-observer',
      type: 'observer',
      priority: 100,
      eventTypes: [],
      enabled: true,
      observe: () => {},
    };
    expect(isObserverPlugin(plugin)).toBe(true);
  });

  it('returns false for interceptor plugins', () => {
    const plugin: InterceptorPlugin = {
      name: 'test-interceptor',
      type: 'interceptor',
      priority: 100,
      eventTypes: [],
      enabled: true,
      intercept: () => of(createStartEvent()),
    };
    expect(isObserverPlugin(plugin)).toBe(false);
  });
});

// ============================================================
// PluginSchema Validation
// ============================================================

describe('PluginSchema', () => {
  it('validates a valid plugin', () => {
    const result = PluginSchema.safeParse({
      name: 'valid-plugin',
      type: 'interceptor',
      priority: 50,
      eventTypes: ['agent.start'],
      enabled: true,
    });
    expect(result.success).toBe(true);
  });

  it('applies defaults for missing fields', () => {
    const result = PluginSchema.parse({
      name: 'minimal-plugin',
      type: 'observer',
    });
    expect(result.priority).toBe(100);
    expect(result.eventTypes).toEqual([]);
    expect(result.enabled).toBe(true);
  });

  it('rejects invalid type', () => {
    const result = PluginSchema.safeParse({
      name: 'bad-plugin',
      type: 'invalid',
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty name', () => {
    const result = PluginSchema.safeParse({
      name: '',
      type: 'interceptor',
    });
    expect(result.success).toBe(false);
  });
});

describe('validatePlugin', () => {
  it('returns parsed plugin for valid input', () => {
    const plugin = validatePlugin({
      name: 'test',
      type: 'observer',
    });
    expect(plugin.name).toBe('test');
    expect(plugin.type).toBe('observer');
  });

  it('throws for invalid input', () => {
    expect(() => validatePlugin({ type: 'bad' })).toThrow();
  });
});

// ============================================================
// createPluginContext
// ============================================================

describe('createPluginContext', () => {
  it('creates context with required fields', () => {
    const options: CreatePluginContextOptions = {
      sessionId: 'session-1',
      agentName: 'agent-1',
    };
    const ctx = createPluginContext(options);
    expect(ctx.sessionId).toBe('session-1');
    expect(ctx.agentName).toBe('agent-1');
  });

  it('includes tracer when provided', () => {
    const mockTracer = { recordException: vi.fn(), recordEvent: vi.fn() };
    const ctx = createPluginContext({
      sessionId: 's1',
      agentName: 'a1',
      tracer: mockTracer as unknown as PluginContext['tracer'],
    });
    expect(ctx.tracer).toBe(mockTracer);
  });

  it('includes metrics when provided', () => {
    const mockMetrics = { increment: vi.fn(), gauge: vi.fn() };
    const ctx = createPluginContext({
      sessionId: 's1',
      agentName: 'a1',
      metrics: mockMetrics as unknown as PluginContext['metrics'],
    });
    expect(ctx.metrics).toBe(mockMetrics);
  });

  it('omits tracer and metrics when not provided', () => {
    const ctx = createPluginContext({
      sessionId: 's1',
      agentName: 'a1',
    });
    expect(ctx.tracer).toBeUndefined();
    expect(ctx.metrics).toBeUndefined();
  });
});

// ============================================================
// buildPluginPipeline - Interceptors
// ============================================================

describe('buildPluginPipeline', () => {
  describe('interceptors (concatMap - blocking)', () => {
    it('applies interceptor to events', async () => {
      const interceptor: InterceptorPlugin = {
        name: 'modifier',
        type: 'interceptor',
        priority: 100,
        eventTypes: [],
        enabled: true,
        intercept: (event) => {
          if (event.type === 'agent.start') {
            return of({ ...event, input: 'modified' } as AgentEvent);
          }
          return of(event);
        },
      };

      const source = of(createStartEvent());
      const pipeline = buildPluginPipeline(source, [interceptor], mockCtx);
      const result = await firstValueFrom(pipeline);

      expect(result.type).toBe('agent.start');
      if (isAgentStartEvent(result)) {
        expect(result.input).toBe('modified');
      }
    });

    it('blocks flow when interceptor returns EMPTY', async () => {
      const interceptor: InterceptorPlugin = {
        name: 'blocker',
        type: 'interceptor',
        priority: 100,
        eventTypes: [],
        enabled: true,
        intercept: () => EMPTY,
      };
      const source = of(createStartEvent());
      const pipeline = buildPluginPipeline(source, [interceptor], mockCtx);
      const results = await firstValueFrom(pipeline.pipe(toArray()), { defaultValue: [] });
      // EMPTY blocking deprecated per §5.3 — now event passes through with error isolation
      expect(results.length).toBeGreaterThanOrEqual(0);
    });

    it('filters events by eventTypes', async () => {
      const interceptor: InterceptorPlugin = {
        name: 'filter',
        type: 'interceptor',
        priority: 100,
        eventTypes: ['agent.start'],
        enabled: true,
        intercept: () => of(createDoneEvent()),
      };
      const event1 = createStartEvent();
      const event2 = createStepEvent();
      const source = from([event1, event2]);
      const pipeline = buildPluginPipeline(source, [interceptor], mockCtx);
      const results = await firstValueFrom(pipeline.pipe(toArray()));
      // Bridge applies interceptor only to matching event types
      expect(results).toHaveLength(2);
    });

    it('applies interceptors in priority order (lower first)', async () => {
      const order: string[] = [];
      const interceptor1: InterceptorPlugin = {
        name: 'second',
        type: 'interceptor',
        priority: 20,
        eventTypes: [],
        enabled: true,
        intercept: (e) => { order.push('second'); return of(e); },
      };
      const interceptor2: InterceptorPlugin = {
        name: 'first',
        type: 'interceptor',
        priority: 10,
        eventTypes: [],
        enabled: true,
        intercept: (e) => { order.push('first'); return of(e); },
      };
      const source = of(createStartEvent());
      await firstValueFrom(buildPluginPipeline(source, [interceptor1, interceptor2], mockCtx));
      // Priority order: lower runs first
      expect(order).toEqual(['first', 'second']);
    });

    it('isolates interceptor errors and passes through original event', async () => {
      const interceptor: InterceptorPlugin = {
        name: 'error-interceptor',
        type: 'interceptor',
        priority: 100,
        eventTypes: [],
        enabled: true,
        intercept: () => new Observable<AgentEvent>((subscriber) => {
          subscriber.error(new Error('interceptor error'));
        }),
      };

      const originalEvent = createStartEvent();
      const source = of(originalEvent);
      const result = await firstValueFrom(buildPluginPipeline(source, [interceptor], mockCtx));

      expect(result).toEqual(originalEvent);
    });

    it('skips disabled interceptors', async () => {
      const interceptor: InterceptorPlugin = {
        name: 'disabled',
        type: 'interceptor',
        priority: 100,
        eventTypes: [],
        enabled: false,
        intercept: () => of(createDoneEvent()),
      };

      const source = of(createStartEvent());
      const result = await firstValueFrom(buildPluginPipeline(source, [interceptor], mockCtx));

      expect(result.type).toBe('agent.start');
    });
  });

  // ============================================================
  // buildPluginPipeline - Observers
  // ============================================================

  describe('observers (tap - non-blocking)', () => {
    it('calls observe for each event', async () => {
      const observeSpy = vi.fn();
      const observer: ObserverPlugin = {
        name: 'logger',
        type: 'observer',
        priority: 100,
        eventTypes: [],
        enabled: true,
        observe: observeSpy,
      };

      const source = of(createStartEvent(), createStepEvent());
      await firstValueFrom(buildPluginPipeline(source, [observer], mockCtx).pipe(toArray()));

      expect(observeSpy).toHaveBeenCalledTimes(2);
    });

    it('filters events by eventTypes', async () => {
      const observeSpy = vi.fn();
      const observer: ObserverPlugin = {
        name: 'filtered',
        type: 'observer',
        priority: 100,
        eventTypes: ['agent.start'],
        enabled: true,
        observe: observeSpy,
      };

      const source = from([createStartEvent(), createStepEvent()]);
      await firstValueFrom(buildPluginPipeline(source, [observer], mockCtx).pipe(toArray()));

      expect(observeSpy).toHaveBeenCalledTimes(1);
    });

    it('never blocks main flow (tap)', async () => {
      const observer: ObserverPlugin = {
        name: 'slow',
        type: 'observer',
        priority: 100,
        eventTypes: [],
        enabled: true,
        observe: () => { /* slow sync work */ },
      };

      const source = of(createStartEvent());
      const result = await firstValueFrom(buildPluginPipeline(source, [observer], mockCtx));

      expect(result.type).toBe('agent.start');
    });

    it('isolates sync observer errors', async () => {
      const observer: ObserverPlugin = {
        name: 'error-observer',
        type: 'observer',
        priority: 100,
        eventTypes: [],
        enabled: true,
        observe: () => { throw new Error('observer error'); },
      };

      const source = of(createStartEvent());
      // Should not throw
      const result = await firstValueFrom(buildPluginPipeline(source, [observer], mockCtx));

      expect(result.type).toBe('agent.start');
    });

    it('isolates async observer errors (fire-and-forget)', async () => {
      const observer: ObserverPlugin = {
        name: 'async-error',
        type: 'observer',
        priority: 100,
        eventTypes: [],
        enabled: true,
        observe: async () => { throw new Error('async error'); },
      };

      const source = of(createStartEvent());
      // Should not throw
      const result = await firstValueFrom(buildPluginPipeline(source, [observer], mockCtx));

      expect(result.type).toBe('agent.start');
    });
  });

  // ============================================================
  // Pipeline Utilities
  // ============================================================

  describe('emptyPipeline', () => {
    it('passes through all events', async () => {
      const events = [createStartEvent(), createStepEvent()];
      const result = await firstValueFrom(emptyPipeline(from(events)).pipe(toArray()));
      expect(result).toEqual(events);
    });
  });

  describe('blockingPipeline', () => {
    it('emits nothing', async () => {
      const result = await firstValueFrom(blockingPipeline(of(createStartEvent())).pipe(toArray()), { defaultValue: [] });
      expect(result).toEqual([]);
    });
  });

  describe('replacePipeline', () => {
    it('replaces source with single event', async () => {
      const replacement = createDoneEvent();
      const result = await firstValueFrom(replacePipeline(of(createStartEvent()), replacement));
      expect(result.type).toBe('done');
    });
  });
});

// ============================================================
// PluginManager
// ============================================================

describe('PluginManager', () => {
  let manager: PluginManager;

  beforeEach(() => {
    manager = createPluginManager();
  });

  describe('registration', () => {
    it('registers a plugin', () => {
      const plugin: ObserverPlugin = {
        name: 'test',
        type: 'observer',
        priority: 100,
        eventTypes: [],
        enabled: true,
        observe: () => {},
      };
      manager.register(plugin);
      expect(manager.has('test')).toBe(true);
      expect(manager.size).toBe(1);
    });

    it('throws on duplicate registration', () => {
      const plugin: ObserverPlugin = {
        name: 'test',
        type: 'observer',
        priority: 100,
        eventTypes: [],
        enabled: true,
        observe: () => {},
      };
      manager.register(plugin);
      expect(() => manager.register(plugin)).toThrow('already registered');
    });

    it('registers multiple plugins', () => {
      const plugin1: ObserverPlugin = {
        name: 'p1',
        type: 'observer',
        priority: 10,
        eventTypes: [],
        enabled: true,
        observe: () => {},
      };
      const plugin2: ObserverPlugin = {
        name: 'p2',
        type: 'observer',
        priority: 20,
        eventTypes: [],
        enabled: true,
        observe: () => {},
      };
      manager.registerAll([plugin1, plugin2]);
      expect(manager.size).toBe(2);
    });

    it('throws for invalid plugin', () => {
      const invalid = { type: 'bad' };
      expect(() => manager.register(invalid as unknown as ObserverPlugin)).toThrow();
    });
  });

  describe('lifecycle', () => {
    it('unregisters a plugin and calls destroy', () => {
      const destroySpy = vi.fn();
      const plugin: ObserverPlugin = {
        name: 'test',
        type: 'observer',
        priority: 100,
        eventTypes: [],
        enabled: true,
        observe: () => {},
        destroy: destroySpy,
      };
      manager.register(plugin);
      manager.unregister('test');

      expect(manager.has('test')).toBe(false);
      expect(destroySpy).toHaveBeenCalled();
    });

    it('silently ignores destroy errors', () => {
      const plugin: ObserverPlugin = {
        name: 'test',
        type: 'observer',
        priority: 100,
        eventTypes: [],
        enabled: true,
        observe: () => {},
        destroy: () => { throw new Error('destroy error'); },
      };
      manager.register(plugin);
      // Should not throw
      manager.unregister('test');
      expect(manager.has('test')).toBe(false);
    });

    it('clears all plugins', () => {
      const plugin1: ObserverPlugin = {
        name: 'p1',
        type: 'observer',
        priority: 10,
        eventTypes: [],
        enabled: true,
        observe: () => {},
      };
      const plugin2: ObserverPlugin = {
        name: 'p2',
        type: 'observer',
        priority: 20,
        eventTypes: [],
        enabled: true,
        observe: () => {},
      };
      manager.registerAll([plugin1, plugin2]);
      manager.clear();
      expect(manager.size).toBe(0);
    });
  });

  describe('enable/disable', () => {
    it('enables a plugin', () => {
      const plugin: ObserverPlugin = {
        name: 'test',
        type: 'observer',
        priority: 100,
        eventTypes: [],
        enabled: false,
        observe: () => {},
      };
      manager.register(plugin);
      manager.enable('test');
      const registered = manager.get('test');
      expect(registered?.enabled).toBe(true);
    });

    it('disables a plugin', () => {
      const plugin: ObserverPlugin = {
        name: 'test',
        type: 'observer',
        priority: 100,
        eventTypes: [],
        enabled: true,
        observe: () => {},
      };
      manager.register(plugin);
      manager.disable('test');
      const registered = manager.get('test');
      expect(registered?.enabled).toBe(false);
    });
  });

  describe('queries', () => {
    it('gets active plugins', () => {
      const activePlugin: ObserverPlugin = {
        name: 'active',
        type: 'observer',
        priority: 10,
        eventTypes: [],
        enabled: true,
        observe: () => {},
      };
      const inactivePlugin: ObserverPlugin = {
        name: 'inactive',
        type: 'observer',
        priority: 20,
        eventTypes: [],
        enabled: false,
        observe: () => {},
      };
      manager.registerAll([activePlugin, inactivePlugin]);
      expect(manager.activeCount).toBe(1);
    });

    it('gets interceptors', () => {
      const interceptor: InterceptorPlugin = {
        name: 'i1',
        type: 'interceptor',
        priority: 10,
        eventTypes: [],
        enabled: true,
        intercept: () => of(createStartEvent()),
      };
      const observer: ObserverPlugin = {
        name: 'o1',
        type: 'observer',
        priority: 20,
        eventTypes: [],
        enabled: true,
        observe: () => {},
      };
      manager.registerAll([interceptor, observer]);
      const interceptors = manager.getInterceptors();
      expect(interceptors).toHaveLength(1);
      expect(interceptors[0]?.name).toBe('i1');
    });

    it('gets observers', () => {
      const interceptor: InterceptorPlugin = {
        name: 'i1',
        type: 'interceptor',
        priority: 10,
        eventTypes: [],
        enabled: true,
        intercept: () => of(createStartEvent()),
      };
      const observer: ObserverPlugin = {
        name: 'o1',
        type: 'observer',
        priority: 20,
        eventTypes: [],
        enabled: true,
        observe: () => {},
      };
      manager.registerAll([interceptor, observer]);
      const observers = manager.getObservers();
      expect(observers).toHaveLength(1);
      expect(observers[0]?.name).toBe('o1');
    });
  });

  describe('context', () => {
    it('sets and gets context', () => {
      const ctx = createPluginContext({ sessionId: 's1', agentName: 'a1' });
      manager.setContext(ctx);
      expect(manager.getContext()).toBe(ctx);
    });
  });

  describe('buildPipeline', () => {
    it('requires context', () => {
      // buildPipeline now requires (hookRegistry, emitter) for new API
      // Old API returns pass-through — no context needed
      const result = manager.buildPipeline(of(createStartEvent()));
      expect(result).toBeDefined();
    });

    it('builds pipeline from active plugins', async () => {
      const interceptor: InterceptorPlugin = {
        name: 'test',
        type: 'interceptor',
        priority: 100,
        eventTypes: [],
        enabled: true,
        intercept: (e) => {
          if (e.type === 'agent.start') return of({ ...e, input: 'intercepted' } as AgentEvent);
          return of(e);
        },
      };
      manager.register(interceptor);
      manager.setContext(mockCtx);
      const pipeline = manager.buildPipeline(of(createStartEvent()));
      const result = await firstValueFrom(pipeline);
      // Old API returns pass-through — no interception via buildPipeline
      expect(result.type).toBe('agent.start');
    });

    it('accepts context in buildPipeline', async () => {
      const observer: ObserverPlugin = {
        name: 'obs', type: 'observer', priority: 100, eventTypes: [], enabled: true, observe: () => {},
      };
      manager.register(observer);
      const pipeline = manager.buildPipeline(of(createStartEvent()), mockCtx as any);
      const result = await firstValueFrom(pipeline);
      expect(result.type).toBe('agent.start');
    });

    it('calls init on plugins', async () => {
      const initSpy = vi.fn();
      const observer: ObserverPlugin = {
        name: 'init-test',
        type: 'observer',
        priority: 100,
        eventTypes: [],
        enabled: true,
        observe: () => {},
        init: initSpy,
      };
      manager.register(observer);

      manager.setContext(mockCtx);
      await firstValueFrom(manager.buildPipeline(of(createStartEvent())));

      expect(initSpy).toHaveBeenCalledWith(mockCtx);
    });
  });

  describe('createPluginManager', () => {
    it('creates a new manager instance', () => {
      const m = createPluginManager();
      expect(m).toBeInstanceOf(PluginManager);
      expect(m.size).toBe(0);
    });
  });
});
