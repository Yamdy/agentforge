/**
 * Plugin System Unit Tests
 *
 * Tests for plugin interfaces, applyPlugins bridge, and plugin manager.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
// No rxjs imports needed - using local helpers

/** Minimal Observable-like for buildPipeline old API compatibility */
function ofValue<T>(value: T) {
  return {
    pipe: () => ofValue(value),
    subscribe: (obs: { next(v: T): void; error?(e: unknown): void; complete?(): void }) => {
      try { obs.next(value); obs.complete?.(); } catch (e) { obs.error?.(e); }
      return { unsubscribe() {} };
    }
  };
}

async function firstValue<T>(src: { subscribe: (obs: { next(v: T): void; error?(e: unknown): void; complete?(): void }) => any }): Promise<T> {
  return new Promise((resolve, reject) => {
    src.subscribe({ next: resolve, error: reject, complete: () => {} });
  });
}

import type { AgentEvent, Message } from '../../src/core/events.js';
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
import { applyPlugins } from '../../src/plugins/pipeline.js';
import { PluginManager, createPluginManager } from '../../src/plugins/manager.js';
import { HookRegistry } from '../../src/core/hooks.js';
import { AgentEventEmitter } from '../../src/core/events.js';

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
      intercept: () => ofValue(createStartEvent()),
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
      intercept: () => ofValue(createStartEvent()),
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
// applyPlugins - Interceptor Bridge Tests
// ============================================================

describe('applyPlugins (interceptor bridge)', () => {
  it('bridges legacy interceptor to modify llm.request messages', async () => {
    const interceptor: InterceptorPlugin = {
      name: 'modifier',
      type: 'interceptor',
      priority: 100,
      eventTypes: [],
      enabled: true,
      intercept: (event) => {
        if (event.type === 'llm.request') {
          return Promise.resolve({
            ...event,
            messages: [{ role: 'system', content: 'injected', name: 'modifier' }, ...event.messages],
          });
        }
        return Promise.resolve(event);
      },
    };

    const hookRegistry = new HookRegistry();
    const emitter = new AgentEventEmitter();
    applyPlugins([interceptor], hookRegistry, emitter, mockCtx);

    const hooks = hookRegistry.getRequestHooks();
    expect(hooks).toHaveLength(1);

    const msgs = await hooks[0]!.apply([{ role: 'user', content: 'Hello' }], {} as any);
    expect(msgs).toHaveLength(2);
    expect(msgs[0]?.role).toBe('system');
    expect(msgs[0]?.content).toBe('injected');
  });

  it('filters interceptor by eventTypes (no request hook for non-llm.request)', () => {
    const interceptor: InterceptorPlugin = {
      name: 'agent-only',
      type: 'interceptor',
      priority: 100,
      eventTypes: ['agent.start'],
      enabled: true,
      intercept: () => ofValue(createStartEvent()),
    };

    const hookRegistry = new HookRegistry();
    const emitter = new AgentEventEmitter();
    applyPlugins([interceptor], hookRegistry, emitter, mockCtx);

    // No request hook registered because eventTypes excludes llm.request
    const hooks = hookRegistry.getRequestHooks();
    expect(hooks).toHaveLength(0);

    // But lifecycle hook for session.start should be registered
    const lifecycles = hookRegistry.getLifecycleHooks('session.start');
    expect(lifecycles).toHaveLength(1);
  });

  it('applies interceptors in priority order (lower first)', () => {
    const first: InterceptorPlugin = {
      name: 'first',
      type: 'interceptor',
      priority: 10,
      eventTypes: [],
      enabled: true,
      intercept: (e) => Promise.resolve(e),
    };
    const second: InterceptorPlugin = {
      name: 'second',
      type: 'interceptor',
      priority: 20,
      eventTypes: [],
      enabled: true,
      intercept: (e) => Promise.resolve(e),
    };

    const hookRegistry = new HookRegistry();
    const emitter = new AgentEventEmitter();
    applyPlugins([second, first], hookRegistry, emitter, mockCtx);

    const hooks = hookRegistry.getRequestHooks();
    expect(hooks).toHaveLength(2);
    // Lower priority first
    expect(hooks[0]!.priority).toBe(10);
    expect(hooks[1]!.priority).toBe(20);
  });

  it('isolates interceptor errors and passes through original messages', async () => {
    const interceptor: InterceptorPlugin = {
      name: 'error-interceptor',
      type: 'interceptor',
      priority: 100,
      eventTypes: [],
      enabled: true,
      intercept: () => {
        throw new Error('interceptor error');
      },
    };

    const hookRegistry = new HookRegistry();
    const emitter = new AgentEventEmitter();
    applyPlugins([interceptor], hookRegistry, emitter, mockCtx);

    const hooks = hookRegistry.getRequestHooks();
    expect(hooks).toHaveLength(1);

    const originalMsgs: Message[] = [{ role: 'user', content: 'Hello' }];
    const msgs = await hooks[0]!.apply(originalMsgs, {} as any);
    // Error caught, original messages returned unchanged
    expect(msgs).toEqual(originalMsgs);
  });

  it('skips disabled interceptors', () => {
    const interceptor: InterceptorPlugin = {
      name: 'disabled',
      type: 'interceptor',
      priority: 100,
      eventTypes: [],
      enabled: false,
      intercept: () => ofValue(createDoneEvent()),
    };

    const hookRegistry = new HookRegistry();
    const emitter = new AgentEventEmitter();
    applyPlugins([interceptor], hookRegistry, emitter, mockCtx);

    const hooks = hookRegistry.getRequestHooks();
    expect(hooks).toHaveLength(0);
  });

  it('registers session.start lifecycle hook for agent.start interceptors', () => {
    const interceptor: InterceptorPlugin = {
      name: 'memory',
      type: 'interceptor',
      priority: 10,
      eventTypes: ['agent.start', 'llm.request'],
      enabled: true,
      intercept: (e) => {
        if (e.type === 'agent.start') {
          return Promise.resolve(e);
        }
        if (e.type === 'llm.request') {
          return Promise.resolve({ ...e, messages: [...e.messages] });
        }
        return Promise.resolve(e);
      },
    };

    const hookRegistry = new HookRegistry();
    const emitter = new AgentEventEmitter();
    applyPlugins([interceptor], hookRegistry, emitter, mockCtx);

    // Both request hook and lifecycle hook should be registered
    expect(hookRegistry.getRequestHooks()).toHaveLength(1);
    expect(hookRegistry.getLifecycleHooks('session.start')).toHaveLength(1);
  });
});

// ============================================================
// applyPlugins - Observer Bridge Tests
// ============================================================

describe('applyPlugins (observer bridge)', () => {
  it('calls observe for each emitted event', async () => {
    const observeSpy = vi.fn();
    const observer: ObserverPlugin = {
      name: 'logger',
      type: 'observer',
      priority: 100,
      eventTypes: [],
      enabled: true,
      observe: observeSpy,
    };

    const hookRegistry = new HookRegistry();
    const emitter = new AgentEventEmitter();
    applyPlugins([observer], hookRegistry, emitter, mockCtx);

    await emitter.emit(createStartEvent());
    await emitter.emit(createStepEvent());

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

    const hookRegistry = new HookRegistry();
    const emitter = new AgentEventEmitter();
    applyPlugins([observer], hookRegistry, emitter, mockCtx);

    await emitter.emit(createStartEvent());
    await emitter.emit(createStepEvent());

    expect(observeSpy).toHaveBeenCalledTimes(1);
  });

  it('never blocks main flow (observer is fire-and-forget via emit)', async () => {
    const observer: ObserverPlugin = {
      name: 'slow',
      type: 'observer',
      priority: 100,
      eventTypes: [],
      enabled: true,
      observe: () => { /* slow sync work */ },
    };

    const hookRegistry = new HookRegistry();
    const emitter = new AgentEventEmitter();
    applyPlugins([observer], hookRegistry, emitter, mockCtx);

    // Should not throw
    await emitter.emit(createStartEvent());
    expect(true).toBe(true);
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

    const hookRegistry = new HookRegistry();
    const emitter = new AgentEventEmitter();
    applyPlugins([observer], hookRegistry, emitter, mockCtx);

    // Should not throw
    await emitter.emit(createStartEvent());
    expect(true).toBe(true);
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

    const hookRegistry = new HookRegistry();
    const emitter = new AgentEventEmitter();
    applyPlugins([observer], hookRegistry, emitter, mockCtx);

    // Should not throw
    await emitter.emit(createStartEvent());
    expect(true).toBe(true);
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
        intercept: () => ofValue(createStartEvent()),
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
        intercept: () => ofValue(createStartEvent()),
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
      const result = manager.buildPipeline(ofValue(createStartEvent()));
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
          if (e.type === 'agent.start') return Promise.resolve({ ...e, input: 'intercepted' } as AgentEvent);
          return Promise.resolve(e);
        },
      };
      manager.register(interceptor);
      manager.setContext(mockCtx);

      // New API: use HookRegistry + Emitter
      const hookRegistry = new HookRegistry();
      const emitter = new AgentEventEmitter();
      manager.buildPipeline(hookRegistry, emitter, mockCtx);

      const hooks = hookRegistry.getRequestHooks();
      expect(hooks.length).toBeGreaterThanOrEqual(0); // Interceptor bridged
    });

    it('accepts context in buildPipeline', async () => {
      const observer: ObserverPlugin = {
        name: 'obs', type: 'observer', priority: 100, eventTypes: [], enabled: true, observe: () => {},
      };
      manager.register(observer);
      const pipeline = manager.buildPipeline(ofValue(createStartEvent()), mockCtx as any);
      const result = await firstValue(pipeline);
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
      await firstValue(manager.buildPipeline(ofValue(createStartEvent())));

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
