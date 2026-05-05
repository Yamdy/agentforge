/**
 * Unit tests for Plugin.state and Plugin.toolHooks fields.
 *
 * Tests the unified ToolHook interface (filter + beforeExecute)
 * and plugin state persistence.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { Plugin, PluginContext } from '../../src/plugins/plugin.js';
import { applyPlugins } from '../../src/plugins/pipeline.js';
import { HookRegistry } from '../../src/core/hooks.js';
import { AgentEventEmitter } from '../../src/core/events.js';
import type { ToolHook } from '../../src/core/hooks.js';
import type { AgentState } from '../../src/core/state.js';
import type { FunctionDefinition } from '../../src/core/interfaces.js';

// ============================================================
// Test Helpers
// ============================================================

function createMockState(): AgentState {
  return {
    sessionId: 'test',
    agentName: 'test',
    model: { provider: 'openai', model: 'gpt-4o' },
    messages: [],
    step: 0,
    maxSteps: 10,
    tokens: { prompt: 0, completion: 0 },
    output: '',
    pendingToolCalls: [],
    recovery: {
      outputTokenEscalationCount: 0,
      recoveryMessageCount: 0,
      fallbackSwitchCount: 0,
      compactionRetryCount: 0,
    },
  };
}

function createMockContext(): PluginContext {
  return { sessionId: 'test', agentName: 'test' };
}

function createToolDefs(): FunctionDefinition[] {
  return [
    { name: 'read', description: 'Read', parameters: {} },
    { name: 'write', description: 'Write', parameters: {} },
    { name: 'execute', description: 'Execute', parameters: {} },
  ];
}

// ============================================================
// Plugin State Tests
// ============================================================

describe('Plugin State', () => {
  let registry: HookRegistry;
  let emitter: AgentEventEmitter;

  beforeEach(() => {
    registry = new HookRegistry();
    emitter = new AgentEventEmitter();
  });

  // ── state field ──

  describe('state field', () => {
    it('should initialize as undefined by default (backward compat)', () => {
      const plugin: Plugin = {
        name: 'minimal',
        enabled: true,
      };
      expect(plugin.state).toBeUndefined();
    });

    it('should allow plugins to carry cross-turn state', () => {
      const plugin: Plugin = {
        name: 'stateful',
        enabled: true,
        state: { counter: 0, phase: 'planning' },
      };
      expect(plugin.state).toEqual({ counter: 0, phase: 'planning' });
    });

    it('should allow state mutation across turns', () => {
      const plugin: Plugin = {
        name: 'counter',
        enabled: true,
        state: { count: 0 },
      };
      // Simulate crossing turns
      (plugin.state as Record<string, number>).count = 1;
      expect(plugin.state).toEqual({ count: 1 });
    });

    it('should isolate state per plugin instance', () => {
      const plugin1: Plugin = { name: 'p1', enabled: true, state: { val: 1 } };
      const plugin2: Plugin = { name: 'p2', enabled: true, state: { val: 2 } };
      expect(plugin1.state).toEqual({ val: 1 });
      expect(plugin2.state).toEqual({ val: 2 });
    });

    it('should work alongside other plugin fields', () => {
      const plugin: Plugin = {
        name: 'full',
        enabled: true,
        state: { counter: 0 },
        requestHooks: [{ name: 'req', priority: 50, apply: (m) => m }],
        toolHooks: [{ name: 'tool', priority: 50, beforeExecute: () => ({ action: 'allow' }) }],
      };
      applyPlugins([plugin], registry, emitter, createMockContext());
      expect(plugin.state).toEqual({ counter: 0 });
      expect(registry.getRequestHooks()).toHaveLength(1);
      expect(registry.getToolHooks()).toHaveLength(1);
    });
  });

  // ── toolHooks (unified: filter + beforeExecute) ──

  describe('toolHooks (unified)', () => {
    it('should register toolHooks with filter via applyPlugins', () => {
      const toolHook: ToolHook = {
        name: 'test-provider',
        priority: 40,
        filter: (tools) => tools,
      };
      const plugin: Plugin = {
        name: 'provider-plugin',
        enabled: true,
        toolHooks: [toolHook],
      };
      applyPlugins([plugin], registry, emitter, createMockContext());
      expect(registry.getToolFilterHooks()).toHaveLength(1);
      expect(registry.getToolFilterHooks()[0]!.name).toBe('test-provider');
    });

    it('should apply toolHooks filter to filter tools', async () => {
      const plugin: Plugin = {
        name: 'sandbox-filter',
        enabled: true,
        toolHooks: [{
          name: 'remove-execute',
          priority: 10,
          filter: (tools) => tools.filter((t) => t.name !== 'execute'),
        }],
      };
      applyPlugins([plugin], registry, emitter, createMockContext());
      const hooks = registry.getToolFilterHooks();
      let tools = createToolDefs();
      for (const h of hooks) {
        tools = await h.filter!(tools, createMockState());
      }
      expect(tools).toHaveLength(2);
      expect(tools.map((t) => t.name)).toEqual(['read', 'write']);
    });

    it('should support multiple toolHooks in one plugin', () => {
      const plugin: Plugin = {
        name: 'multi-provider',
        enabled: true,
        toolHooks: [
          { name: 'hook-a', priority: 10, filter: (t) => t },
          { name: 'hook-b', priority: 20, filter: (t) => t },
        ],
      };
      applyPlugins([plugin], registry, emitter, createMockContext());
      expect(registry.getToolFilterHooks()).toHaveLength(2);
    });

    it('should work with BOTH filter and beforeExecute on a single toolHook', () => {
      const plugin: Plugin = {
        name: 'dual-hook',
        enabled: true,
        toolHooks: [{
          name: 'filter-and-guard',
          priority: 40,
          filter: (t) => t,
          beforeExecute: () => ({ action: 'allow' }),
        }],
      };
      applyPlugins([plugin], registry, emitter, createMockContext());
      const allHooks = registry.getToolHooks();
      expect(allHooks).toHaveLength(1);
      const filterHooks = registry.getToolFilterHooks();
      expect(filterHooks).toHaveLength(1);
    });

    it('should support tool injection via toolHooks filter', async () => {
      const plugin: Plugin = {
        name: 'phase-aware',
        enabled: true,
        toolHooks: [{
          name: 'add-planning-tool',
          priority: 10,
          filter: (tools) => [...tools, { name: 'write_todos', description: 'Plan', parameters: {} }],
        }],
      };
      applyPlugins([plugin], registry, emitter, createMockContext());
      const hooks = registry.getToolFilterHooks();
      let tools: FunctionDefinition[] = [{ name: 'read', description: 'Read', parameters: {} }];
      for (const h of hooks) {
        tools = await h.filter!(tools, createMockState());
      }
      expect(tools).toHaveLength(2);
      expect(tools[1]!.name).toBe('write_todos');
    });

    it('should unregister toolHooks when cleanup returned', () => {
      const plugin: Plugin = {
        name: 'temp-provider',
        enabled: true,
        toolHooks: [{ name: 'temp', priority: 10, filter: (t) => t }],
      };
      const { unregister: cleanup } = applyPlugins([plugin], registry, emitter, createMockContext());
      expect(registry.getToolFilterHooks()).toHaveLength(1);
      cleanup();
      expect(registry.getToolFilterHooks()).toHaveLength(0);
    });

    it('should not crash when plugin has no toolHooks', () => {
      const plugin: Plugin = {
        name: 'old-plugin',
        enabled: true,
        requestHooks: [{ name: 'req', priority: 50, apply: (m) => m }],
      };
      expect(() => applyPlugins([plugin], registry, emitter, createMockContext())).not.toThrow();
    });
  });

  // ── Multiple Plugins ──

  describe('multiple plugins with toolHooks', () => {
    it('should execute toolHooks filter from multiple plugins in priority order', async () => {
      const plugin1: Plugin = {
        name: 'remove-execute',
        enabled: true,
        toolHooks: [{ name: 'remove-execute', priority: 10, filter: (t) => t.filter((d) => d.name !== 'execute') }],
      };
      const plugin2: Plugin = {
        name: 'add-todo',
        enabled: true,
        toolHooks: [{ name: 'add-todo', priority: 20, filter: (t) => [...t, { name: 'write_todos', description: '', parameters: {} }] }],
      };
      applyPlugins([plugin1, plugin2], registry, emitter, createMockContext());

      const hooks = registry.getToolFilterHooks();
      let tools = createToolDefs();
      for (const h of hooks) {
        tools = await h.filter!(tools, createMockState());
      }
      // remove-execute (priority 10) runs first, then add-todo (priority 20)
      expect(tools.map((t) => t.name).sort()).toEqual(['read', 'write', 'write_todos']);
    });

    it('should disable plugin and skip its hooks', () => {
      const plugin: Plugin = {
        name: 'disabled',
        enabled: false,
        toolHooks: [{ name: 'skip-me', priority: 10, filter: (t) => t }],
      };
      applyPlugins([plugin], registry, emitter, createMockContext());
      expect(registry.getToolFilterHooks()).toHaveLength(0);
    });

    it('should clean up all hooks from all plugins on cleanup', () => {
      const plugin1: Plugin = {
        name: 'p1',
        enabled: true,
        toolHooks: [{ name: 'h1', priority: 10, filter: (t) => t }],
      };
      const plugin2: Plugin = {
        name: 'p2',
        enabled: true,
        toolHooks: [{ name: 'h2', priority: 20, filter: (t) => t }],
      };
      const { unregister: cleanup } = applyPlugins([plugin1, plugin2], registry, emitter, createMockContext());
      expect(registry.getToolFilterHooks()).toHaveLength(2);
      cleanup();
      expect(registry.getToolFilterHooks()).toHaveLength(0);
    });
  });
});
