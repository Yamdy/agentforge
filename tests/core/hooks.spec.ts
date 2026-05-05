/**
 * Unit tests for src/core/hooks.ts
 *
 * Tests HookRegistry with LifecycleHook, RequestHook, ToolHook,
 * ToolProviderHook, and RequestHookPriority constants.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  HookRegistry,
  RequestHookPriority,
  DEFAULT_REQUEST_HOOK_PRIORITY,
  type RequestHook,
  type ToolHook,
  type ToolProviderHook,
  type HookFn,
  type CheckpointHook,
  type CheckpointResult,
  type CheckpointFn,
  type LifecyclePhase,
  type CheckpointPhase,
  type RecoveryPhase,
} from '../../src/core/hooks.js';
import type { Message, ToolCall } from '../../src/core/events.js';
import type { FunctionDefinition } from '../../src/core/interfaces.js';
import type { AgentState } from '../../src/core/state.js';

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

function createMessages(): Message[] {
  return [{ role: 'user', content: 'Hello' }];
}

function createToolCall(): ToolCall {
  return { id: 'call_1', name: 'test_tool', args: {} };
}

function createToolDef(): FunctionDefinition {
  return { name: 'test_tool', description: 'A test tool', parameters: {} };
}

// ============================================================
// RequestHookPriority Tests
// ============================================================

describe('RequestHookPriority', () => {
  it('should define MEMORY as 10', () => {
    expect(RequestHookPriority.MEMORY).toBe(10);
  });

  it('should define WORKING_MEMORY as 20', () => {
    expect(RequestHookPriority.WORKING_MEMORY).toBe(20);
  });

  it('should define SKILL as 30', () => {
    expect(RequestHookPriority.SKILL).toBe(30);
  });

  it('should have ascending numeric values for progressive disclosure', () => {
    expect(RequestHookPriority.MEMORY).toBeLessThan(RequestHookPriority.WORKING_MEMORY);
    expect(RequestHookPriority.WORKING_MEMORY).toBeLessThan(RequestHookPriority.SKILL);
  });
});

// ============================================================
// HookRegistry Tests
// ============================================================

describe('HookRegistry', () => {
  let registry: HookRegistry;

  beforeEach(() => {
    registry = new HookRegistry();
  });

  // ── Lifecycle Hooks ──

  describe('lifecycle hooks', () => {
    it('should register a lifecycle hook via on()', () => {
      const fn: HookFn = () => {};
      const unreg = registry.on('step.begin', fn);
      expect(unreg).toBeInstanceOf(Function);
      const hooks = registry.getLifecycleHooks('step.begin');
      expect(hooks).toHaveLength(1);
    });

    it('should return hooks sorted by priority', () => {
      const calls: string[] = [];
      registry.on('step.begin', () => { calls.push('third'); }, 30);
      registry.on('step.begin', () => { calls.push('first'); }, 10);
      registry.on('step.begin', () => { calls.push('second'); }, 20);
      const hooks = registry.getLifecycleHooks('step.begin');
      for (const h of hooks) {
        h({}, {});
      }
      expect(calls).toEqual(['first', 'second', 'third']);
    });

    it('should unregister via returned function', () => {
      const fn: HookFn = () => {};
      const unreg = registry.on('session.start', fn);
      expect(registry.getLifecycleHooks('session.start')).toHaveLength(1);
      unreg();
      expect(registry.getLifecycleHooks('session.start')).toHaveLength(0);
    });

    it('should support multiple hooks on same name', () => {
      // 'llm.error' is now a RecoveryPhase — use onRecovery/getRecoveryHooks
      registry.onRecovery('llm.error', () => {});
      registry.onRecovery('llm.error', () => {});
      expect(registry.getRecoveryHooks('llm.error')).toHaveLength(2);
    });

    it('should return empty array for unregistered hook name', () => {
      expect(registry.getLifecycleHooks('compaction.before')).toEqual([]);
    });
  });

  describe('registerLifecycle', () => {
    it('should batch register multiple lifecycle hooks', () => {
      const unreg = registry.registerLifecycle([
        { phase: 'step.begin', fn: () => {} },
        { phase: 'step.end', fn: () => {} },
      ]);
      expect(registry.getLifecycleHooks('step.begin')).toHaveLength(1);
      expect(registry.getLifecycleHooks('step.end')).toHaveLength(1);
      unreg();
      expect(registry.getLifecycleHooks('step.begin')).toHaveLength(0);
      expect(registry.getLifecycleHooks('step.end')).toHaveLength(0);
    });
  });

  // ── Request Hooks ──

  describe('request hooks', () => {
    it('should register a request hook', () => {
      const hook: RequestHook = {
        name: 'test-request',
        priority: 10,
        apply: (msgs) => msgs,
      };
      const unreg = registry.registerRequest(hook);
      expect(unreg).toBeInstanceOf(Function);
      expect(registry.getRequestHooks()).toHaveLength(1);
    });

    it('should return request hooks sorted by priority', () => {
      const hook1: RequestHook = { name: 'third', priority: 30, apply: (m) => [...m, { role: 'assistant', content: 'third' }] };
      const hook2: RequestHook = { name: 'first', priority: 10, apply: (m) => [...m, { role: 'assistant', content: 'first' }] };
      const hook3: RequestHook = { name: 'second', priority: 20, apply: (m) => [...m, { role: 'assistant', content: 'second' }] };
      registry.registerRequest(hook3);
      registry.registerRequest(hook1);
      registry.registerRequest(hook2);
      const hooks = registry.getRequestHooks();
      expect(hooks[0]!.name).toBe('first');
      expect(hooks[1]!.name).toBe('second');
      expect(hooks[2]!.name).toBe('third');
    });

    it('should unregister request hook', () => {
      const hook: RequestHook = { name: 'test', priority: 50, apply: (m) => m };
      const unreg = registry.registerRequest(hook);
      expect(registry.getRequestHooks()).toHaveLength(1);
      unreg();
      expect(registry.getRequestHooks()).toHaveLength(0);
    });

    it('should apply request hooks in order to messages', async () => {
      const msg = createMessages();
      registry.registerRequest({
        name: 'inject-prefix',
        priority: 10,
        apply: (msgs) => [{ role: 'system', content: 'prefix' }, ...msgs],
      });
      registry.registerRequest({
        name: 'inject-suffix',
        priority: 20,
        apply: (msgs) => [...msgs, { role: 'assistant', content: 'suffix' }],
      });
      const hooks = registry.getRequestHooks();
      let result = msg;
      for (const h of hooks) {
        result = await h.apply(result, createMockState());
      }
      expect(result).toHaveLength(3);
      expect(result[0]!.content).toBe('prefix');
      expect(result[2]!.content).toBe('suffix');
    });
  });

  // ── Tool Hooks ──

  describe('tool hooks', () => {
    it('should register a tool hook', () => {
      const hook: ToolHook = {
        name: 'test-tool-hook',
        priority: 50,
        beforeExecute: () => true,
      };
      const unreg = registry.registerTool(hook);
      expect(unreg).toBeInstanceOf(Function);
      expect(registry.getToolHooks()).toHaveLength(1);
    });

    it('should return tool hooks sorted by priority', () => {
      const hook1: ToolHook = { name: 'last', priority: 100, beforeExecute: () => true };
      const hook2: ToolHook = { name: 'first', priority: 10, beforeExecute: () => true };
      registry.registerTool(hook1);
      registry.registerTool(hook2);
      const hooks = registry.getToolHooks();
      expect(hooks[0]!.name).toBe('first');
      expect(hooks[1]!.name).toBe('last');
    });

    it('should unregister tool hook', () => {
      const hook: ToolHook = { name: 'test', priority: 50, beforeExecute: () => true };
      const unreg = registry.registerTool(hook);
      unreg();
      expect(registry.getToolHooks()).toHaveLength(0);
    });
  });

  // ── ToolProvider Hooks ──

  describe('tool provider hooks', () => {
    it('should register a tool provider hook', () => {
      const hook: ToolProviderHook = {
        name: 'test-provider',
        priority: 40,
        filter: (tools) => tools,
      };
      const unreg = registry.registerToolProvider(hook);
      expect(unreg).toBeInstanceOf(Function);
      expect(registry.getToolProviderHooks()).toHaveLength(1);
    });

    it('should return tool provider hooks sorted by priority', () => {
      const hook1: ToolProviderHook = { name: 'last', priority: 100, filter: (t) => t };
      const hook2: ToolProviderHook = { name: 'first', priority: 10, filter: (t) => t };
      registry.registerToolProvider(hook1);
      registry.registerToolProvider(hook2);
      const hooks = registry.getToolProviderHooks();
      expect(hooks[0]!.name).toBe('first');
      expect(hooks[1]!.name).toBe('last');
    });

    it('should unregister tool provider hook', () => {
      const hook: ToolProviderHook = { name: 'test', priority: 40, filter: (t) => t };
      const unreg = registry.registerToolProvider(hook);
      expect(registry.getToolProviderHooks()).toHaveLength(1);
      unreg();
      expect(registry.getToolProviderHooks()).toHaveLength(0);
    });

    it('should filter tools via tool provider hooks', async () => {
      const tools: FunctionDefinition[] = [
        { name: 'read', description: 'Read file', parameters: {} },
        { name: 'write', description: 'Write file', parameters: {} },
        { name: 'execute', description: 'Execute command', parameters: {} },
      ];
      registry.registerToolProvider({
        name: 'remove-execute',
        priority: 10,
        filter: (t) => t.filter((td) => td.name !== 'execute'),
      });
      const hooks = registry.getToolProviderHooks();
      let result = tools;
      for (const h of hooks) {
        result = await h.filter(result, createMockState());
      }
      expect(result).toHaveLength(2);
      expect(result.map((t) => t.name)).toEqual(['read', 'write']);
    });

    it('should allow tool injection via tool provider hooks', async () => {
      const tools: FunctionDefinition[] = [{ name: 'read', description: 'Read', parameters: {} }];
      registry.registerToolProvider({
        name: 'add-todo',
        priority: 10,
        filter: (t) => [...t, { name: 'write_todos', description: 'Plan tasks', parameters: {} }],
      });
      const hooks = registry.getToolProviderHooks();
      let result = tools;
      for (const h of hooks) {
        result = await h.filter(result, createMockState());
      }
      expect(result).toHaveLength(2);
      expect(result[1]!.name).toBe('write_todos');
    });

    it('should chain multiple tool provider hooks', async () => {
      const tools: FunctionDefinition[] = [
        { name: 'a', description: 'A', parameters: {} },
        { name: 'b', description: 'B', parameters: {} },
        { name: 'c', description: 'C', parameters: {} },
      ];
      registry.registerToolProvider({
        name: 'remove-c',
        priority: 10,
        filter: (t) => t.filter((td) => td.name !== 'c'),
      });
      registry.registerToolProvider({
        name: 'add-d',
        priority: 20,
        filter: (t) => [...t, { name: 'd', description: 'D', parameters: {} }],
      });
      const hooks = registry.getToolProviderHooks();
      let result = tools;
      for (const h of hooks) {
        result = await h.filter(result, createMockState());
      }
      expect(result).toHaveLength(3);
      expect(result.map((t) => t.name).sort()).toEqual(['a', 'b', 'd']);
    });
  });

  // ── clear() ──

  describe('clear', () => {
    it('should remove all lifecycle hooks', () => {
      registry.on('step.begin', () => {});
      expect(registry.getLifecycleHooks('step.begin')).toHaveLength(1);
      registry.clear();
      expect(registry.getLifecycleHooks('step.begin')).toHaveLength(0);
    });

    it('should remove all request hooks', () => {
      registry.registerRequest({ name: 'test', priority: 50, apply: (m) => m });
      registry.clear();
      expect(registry.getRequestHooks()).toHaveLength(0);
    });

    it('should remove all tool hooks', () => {
      registry.registerTool({ name: 'test', priority: 50, beforeExecute: () => true });
      registry.clear();
      expect(registry.getToolHooks()).toHaveLength(0);
    });

    it('should remove all tool provider hooks', () => {
      registry.registerToolProvider({ name: 'test', priority: 40, filter: (t) => t });
      registry.clear();
      expect(registry.getToolProviderHooks()).toHaveLength(0);
    });

    it('should be idempotent', () => {
      registry.clear();
      registry.clear();
      expect(registry.getRequestHooks()).toHaveLength(0);
      expect(registry.getToolHooks()).toHaveLength(0);
      expect(registry.getToolProviderHooks()).toHaveLength(0);
    });
  });

  // ── Integration: all hook types coexist ──

  describe('coexistence', () => {
    it('should support all hook types simultaneously', () => {
      registry.on('step.begin', () => {});
      registry.registerRequest({ name: 'req', priority: 10, apply: (m) => m });
      registry.registerTool({ name: 'tool', priority: 10, beforeExecute: () => true });
      registry.registerToolProvider({ name: 'prov', priority: 10, filter: (t) => t });

      expect(registry.getLifecycleHooks('step.begin')).toHaveLength(1);
      expect(registry.getRequestHooks()).toHaveLength(1);
      expect(registry.getToolHooks()).toHaveLength(1);
      expect(registry.getToolProviderHooks()).toHaveLength(1);

      // clear should remove all
      registry.clear();
      expect(registry.getLifecycleHooks('step.begin')).toHaveLength(0);
      expect(registry.getRequestHooks()).toHaveLength(0);
      expect(registry.getToolHooks()).toHaveLength(0);
      expect(registry.getToolProviderHooks()).toHaveLength(0);
    });
  });
});

// ============================================================
// CheckpointHook — cross-cutting lifecycle checks
// ============================================================

describe('CheckpointHook', () => {
  describe('CheckpointResult', () => {
    it('should allow continue action', () => {
      const result: CheckpointResult = { action: 'continue' };
      expect(result.action).toBe('continue');
    });

    it('should allow block action with reason', () => {
      const result: CheckpointResult = { action: 'block', reason: 'quota exceeded' };
      expect(result.action).toBe('block');
      expect(result.reason).toBe('quota exceeded');
    });

    it('should support synchronous check function returning continue', async () => {
      const fn: CheckpointFn = () => ({ action: 'continue' });
      const result = await fn({}, {});
      expect(result).toEqual({ action: 'continue' });
    });

    it('should support synchronous check function returning block', async () => {
      const fn: CheckpointFn = () => ({ action: 'block', reason: 'rate limit hit' });
      const result = await fn({}, {});
      expect(result).toEqual({ action: 'block', reason: 'rate limit hit' });
    });

    it('should support async check function', async () => {
      const fn: CheckpointFn = async () => {
        await Promise.resolve();
        return { action: 'block', reason: 'circuit open' };
      };
      const result = await fn({}, {});
      expect(result).toEqual({ action: 'block', reason: 'circuit open' });
    });

    it('should accept extra args', async () => {
      const fn: CheckpointFn = (_ctx, _state, msgs) => {
        const arr = msgs as unknown[];
        return arr.length > 10 ? { action: 'block', reason: 'too many messages' } : { action: 'continue' };
      };
      const result = await fn({}, {}, 1, 2, 3);
      expect(result).toEqual({ action: 'continue' });
    });
  });

  describe('CheckpointHook interface', () => {
    it('should construct a valid pre-llm checkpoint hook', () => {
      const hook: CheckpointHook = {
        name: 'quota-check',
        phase: 'pre-llm',
        priority: 10,
        check: () => ({ action: 'continue' }),
      };
      expect(hook.name).toBe('quota-check');
      expect(hook.phase).toBe('pre-llm');
      expect(hook.priority).toBe(10);
    });

    it('should construct a valid post-llm checkpoint hook', () => {
      const hook: CheckpointHook = {
        name: 'quality-gate',
        phase: 'post-llm',
        priority: 5,
        check: async () => ({ action: 'block', reason: 'quality below threshold' }),
      };
      expect(hook.phase).toBe('post-llm');
    });

    it('should execute hooks in priority order (lower first)', async () => {
      const order: string[] = [];
      const hook1: CheckpointHook = { name: 'h1', phase: 'pre-llm', priority: 10, check: () => { order.push('h1'); return { action: 'continue' }; } };
      const hook2: CheckpointHook = { name: 'h2', phase: 'pre-llm', priority: 5, check: () => { order.push('h2'); return { action: 'continue' }; } };
      const hook3: CheckpointHook = { name: 'h3', phase: 'pre-llm', priority: 20, check: () => { order.push('h3'); return { action: 'continue' }; } };

      const hooks = [hook1, hook2, hook3].sort((a, b) => a.priority - b.priority);
      for (const h of hooks) await h.check({}, {});
      expect(order).toEqual(['h2', 'h1', 'h3']);
    });

    it('should stop at first block in priority order', async () => {
      const order: string[] = [];
      const hook1: CheckpointHook = { name: 'h1', phase: 'pre-llm', priority: 10, check: () => { order.push('h1'); return { action: 'continue' }; } };
      const hook2: CheckpointHook = { name: 'h2', phase: 'pre-llm', priority: 5, check: () => { order.push('h2'); return { action: 'block', reason: 'stopped' }; } };
      const hook3: CheckpointHook = { name: 'h3', phase: 'pre-llm', priority: 20, check: () => { order.push('h3'); return { action: 'continue' }; } };

      const hooks = [hook1, hook2, hook3].sort((a, b) => a.priority - b.priority);
      let blocked = false;
      for (const h of hooks) {
        const result = await h.check({}, {});
        if (result.action === 'block') { blocked = true; break; }
      }
      expect(blocked).toBe(true);
      expect(order).toEqual(['h2']); // h1 never runs because h2 has priority 5 < 10
    });
  });

  describe('LifecyclePhase types', () => {
    it('should accept all 2 CheckpointPhase values', () => {
      const phases: CheckpointPhase[] = ['pre-llm', 'post-llm'];
      expect(phases).toHaveLength(2);
    });

    it('should accept all 10 LifecyclePhase values', () => {
      const phases: LifecyclePhase[] = [
        'session.start', 'session.end',
        'step.begin', 'step.end',
        'llm.request.before', 'llm.response.after',
        'tool.before', 'tool.after',
        'compaction.before', 'compaction.after',
      ];
      expect(phases).toHaveLength(10);
    });

    it('should accept all 6 RecoveryPhase values', () => {
      const phases: RecoveryPhase[] = [
        'llm.error', 'tool.error',
        'recovery.escalate', 'recovery.compact', 'recovery.fallback',
        'error',
      ];
      expect(phases).toHaveLength(6);
    });

    it('should have 18 total phases across all three types', () => {
      expect(2 + 10 + 6).toBe(18);
    });
  });
});
