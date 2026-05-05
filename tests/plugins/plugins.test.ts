/**
 * Plugin System Unit Tests
 *
 * Tests for plugin interfaces, applyPlugins, and plugin manager.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

import type { Message } from '../../src/core/events.js';
import {
  type PluginContext,
  type CreatePluginContextOptions,
  type Plugin,
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

function createPlugin(name: string, overrides?: Partial<Plugin>): Plugin {
  return {
    name,
    enabled: true,
    ...overrides,
  };
}

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
// applyPlugins — New API
// ============================================================

describe('applyPlugins', () => {
  it('registers requestHooks into hookRegistry', () => {
    const plugin = createPlugin('test', {
      requestHooks: [{
        name: 'test-hook',
        priority: 50,
        apply(messages: Message[]): Message[] {
          return [{ role: 'system', content: 'injected' }, ...messages];
        },
      }],
    });

    const hookRegistry = new HookRegistry();
    const emitter = new AgentEventEmitter();
    applyPlugins([plugin], hookRegistry, emitter, mockCtx);

    const hooks = hookRegistry.getRequestHooks();
    expect(hooks).toHaveLength(1);
    expect(hooks[0]!.name).toBe('test-hook');
  });

  it('registers event subscriptions that fire on emit', async () => {
    const handler = vi.fn();
    const plugin = createPlugin('test', {
      eventSubscriptions: [
        { event: 'agent.start', handler },
      ],
    });

    const hookRegistry = new HookRegistry();
    const emitter = new AgentEventEmitter();
    applyPlugins([plugin], hookRegistry, emitter, mockCtx);

    await emitter.emit({
      type: 'agent.start',
      timestamp: Date.now(),
      sessionId: 'test',
      input: 'Hello',
      agentName: 'test',
      model: { provider: 'openai', model: 'gpt-4o' },
    } as AgentEvent);

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('registers event subscriptions on emitter', async () => {
    const handler = vi.fn();
    const plugin = createPlugin('test', {
      eventSubscriptions: [
        { event: 'agent.step', handler },
      ],
    });

    const hookRegistry = new HookRegistry();
    const emitter = new AgentEventEmitter();
    applyPlugins([plugin], hookRegistry, emitter, mockCtx);

    await emitter.emit({
      type: 'agent.step',
      timestamp: Date.now(),
      sessionId: 'test',
      step: 1,
      maxSteps: 10,
    });

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('skips disabled plugins', () => {
    const plugin = createPlugin('disabled', {
      enabled: false,
      requestHooks: [{
        name: 'should-not-register',
        priority: 50,
        apply(messages: Message[]): Message[] { return messages; },
      }],
    });

    const hookRegistry = new HookRegistry();
    const emitter = new AgentEventEmitter();
    applyPlugins([plugin], hookRegistry, emitter, mockCtx);

    expect(hookRegistry.getRequestHooks()).toHaveLength(0);
  });

  it('returns an unregister function that removes all hooks', async () => {
    const handler = vi.fn();
    const plugin = createPlugin('test', {
      requestHooks: [{
        name: 'test-hook',
        priority: 50,
        apply(messages: Message[]): Message[] { return messages; },
      }],
      eventSubscriptions: [
        { event: 'agent.start', handler },
      ],
    });

    const hookRegistry = new HookRegistry();
    const emitter = new AgentEventEmitter();
    const { unregister } = applyPlugins([plugin], hookRegistry, emitter, mockCtx);

    expect(hookRegistry.getRequestHooks()).toHaveLength(1);

    unregister();

    expect(hookRegistry.getRequestHooks()).toHaveLength(0);
    // After unregister, handler should not fire
    await emitter.emit({
      type: 'agent.start',
      timestamp: Date.now(),
      sessionId: 'test',
      input: 'Hello',
      agentName: 'test',
      model: { provider: 'openai', model: 'gpt-4o' },
    } as AgentEvent);
    expect(handler).not.toHaveBeenCalled();
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
      const plugin = createPlugin('test');
      manager.register(plugin);
      expect(manager.has('test')).toBe(true);
    });

    it('throws when registering duplicate plugin name', () => {
      manager.register(createPlugin('test'));
      expect(() => manager.register(createPlugin('test'))).toThrow(/already registered/);
    });

    it('unregisters a plugin and calls destroy', () => {
      const destroyFn = vi.fn();
      const plugin = createPlugin('test', { destroy: destroyFn });
      manager.register(plugin);
      manager.unregister('test');
      expect(manager.has('test')).toBe(false);
      expect(destroyFn).toHaveBeenCalled();
    });

    it('enables and disables plugins', () => {
      const plugin = createPlugin('test', { enabled: true });
      manager.register(plugin);

      manager.disable('test');
      expect(plugin.enabled).toBe(false);

      manager.enable('test');
      expect(plugin.enabled).toBe(true);
    });
  });

  describe('queries', () => {
    it('returns all plugins', () => {
      manager.register(createPlugin('p1'));
      manager.register(createPlugin('p2'));
      expect(manager.getAll()).toHaveLength(2);
    });

    it('filters active plugins by enabled state', () => {
      manager.register(createPlugin('active', { enabled: true }));
      manager.register(createPlugin('inactive', { enabled: false }));
      expect(manager.getActivePlugins()).toHaveLength(1);
      expect(manager.getActivePlugins()[0]!.name).toBe('active');
    });

    it('tracks active count', () => {
      manager.register(createPlugin('p1'));
      manager.register(createPlugin('p2'));
      expect(manager.activeCount).toBe(2);
    });
  });

  describe('buildPipeline', () => {
    it('registers hooks via applyPlugins', () => {
      const plugin = createPlugin('test', {
        requestHooks: [{
          name: 'test-hook',
          priority: 50,
          apply(messages: Message[]): Message[] { return messages; },
        }],
      });

      manager.register(plugin);
      manager.setContext(mockCtx);

      const hookRegistry = new HookRegistry();
      const emitter = new AgentEventEmitter();
      manager.buildPipeline(hookRegistry, emitter);

      expect(hookRegistry.getRequestHooks()).toHaveLength(1);
    });

    it('throws when context is not set', () => {
      const hookRegistry = new HookRegistry();
      const emitter = new AgentEventEmitter();
      expect(() => manager.buildPipeline(hookRegistry, emitter)).toThrow(/context/i);
    });

    it('accepts context as third parameter', () => {
      const hookRegistry = new HookRegistry();
      const emitter = new AgentEventEmitter();
      expect(() => manager.buildPipeline(hookRegistry, emitter, mockCtx)).not.toThrow();
    });

    it('calls init on plugins with context', async () => {
      const initFn = vi.fn();
      const plugin = createPlugin('test', { init: initFn });
      manager.register(plugin);

      const hookRegistry = new HookRegistry();
      const emitter = new AgentEventEmitter();

      vi.useFakeTimers();
      manager.buildPipeline(hookRegistry, emitter, mockCtx);
      await vi.advanceTimersByTimeAsync(50);
      vi.useRealTimers();

      expect(initFn).toHaveBeenCalledWith(mockCtx);
    });
  });

  describe('clear', () => {
    it('removes all plugins and calls destroy', () => {
      const destroyFn = vi.fn();
      manager.register(createPlugin('p1', { destroy: destroyFn }));
      manager.register(createPlugin('p2'));

      manager.clear();

      expect(manager.size).toBe(0);
      expect(destroyFn).toHaveBeenCalled();
    });
  });
});
