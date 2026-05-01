/**
 * Unit tests for src/core/hooks.ts
 *
 * Tests HookRegistry with LifecycleHook, RequestHook, ToolHook,
 * ToolProviderHook, and RequestHookPriority constants.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  HookRegistry,
  HookName,
  RequestHookPriority,
  type RequestHook,
  type ToolHook,
  type ToolProviderHook,
  type HookFn,
} from '../../src/core/hooks.js';
import type { Message, ToolCall } from '../../src/core/events.js';
import type { FunctionDefinition } from '../../src/core/interfaces.js';
import type { AgentLoopState } from '../../src/core/state.js';

// ============================================================
// Test Helpers
// ============================================================

function createMockState(): AgentLoopState {
  return {
    sessionId: 'test',
    agentName: 'test',
    model: { provider: 'openai', model: 'gpt-4o' },
    messages: [],
    step: 0,
    maxSteps: 10,
    tokens: { prompt: 0, completion: 0 },
    output: '',
    recovery: {
      outputTokenEscalationCount: 0,
      recoveryMessageCount: 0,
      fallbackSwitchCount: 0,
      compactionRetryCount: 0,
    },
  } as AgentLoopState;
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
  it('should define SYSTEM_RULES as 10', () => {
    expect(RequestHookPriority.SYSTEM_RULES).toBe(10);
  });

  it('should define MEMORY_CONTEXT as 20', () => {
    expect(RequestHookPriority.MEMORY_CONTEXT).toBe(20);
  });

  it('should define SKILL_INSTRUCTIONS as 30', () => {
    expect(RequestHookPriority.SKILL_INSTRUCTIONS).toBe(30);
  });

  it('should define TOOL_DESCRIPTIONS as 40', () => {
    expect(RequestHookPriority.TOOL_DESCRIPTIONS).toBe(40);
  });

  it('should define USER_CUSTOM as 50', () => {
    expect(RequestHookPriority.USER_CUSTOM).toBe(50);
  });

  it('should have ascending numeric values for progressive disclosure', () => {
    expect(RequestHookPriority.SYSTEM_RULES).toBeLessThan(RequestHookPriority.MEMORY_CONTEXT);
    expect(RequestHookPriority.MEMORY_CONTEXT).toBeLessThan(RequestHookPriority.SKILL_INSTRUCTIONS);
    expect(RequestHookPriority.SKILL_INSTRUCTIONS).toBeLessThan(RequestHookPriority.TOOL_DESCRIPTIONS);
    expect(RequestHookPriority.TOOL_DESCRIPTIONS).toBeLessThan(RequestHookPriority.USER_CUSTOM);
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
      const unreg = registry.on(HookName['step.begin'], fn);
      expect(unreg).toBeInstanceOf(Function);
      const hooks = registry.getLifecycleHooks(HookName['step.begin']);
      expect(hooks).toHaveLength(1);
    });

    it('should return hooks sorted by priority', () => {
      const calls: string[] = [];
      registry.on(HookName['step.begin'], () => { calls.push('third'); }, 30);
      registry.on(HookName['step.begin'], () => { calls.push('first'); }, 10);
      registry.on(HookName['step.begin'], () => { calls.push('second'); }, 20);
      const hooks = registry.getLifecycleHooks(HookName['step.begin']);
      for (const h of hooks) {
        h({}, {});
      }
      expect(calls).toEqual(['first', 'second', 'third']);
    });

    it('should unregister via returned function', () => {
      const fn: HookFn = () => {};
      const unreg = registry.on(HookName['session.start'], fn);
      expect(registry.getLifecycleHooks(HookName['session.start'])).toHaveLength(1);
      unreg();
      expect(registry.getLifecycleHooks(HookName['session.start'])).toHaveLength(0);
    });

    it('should support multiple hooks on same name', () => {
      registry.on(HookName['llm.error'], () => {});
      registry.on(HookName['llm.error'], () => {});
      expect(registry.getLifecycleHooks(HookName['llm.error'])).toHaveLength(2);
    });

    it('should return empty array for unregistered hook name', () => {
      expect(registry.getLifecycleHooks(HookName['compaction.before'])).toEqual([]);
    });
  });

  describe('registerLifecycle', () => {
    it('should batch register multiple lifecycle hooks', () => {
      const unreg = registry.registerLifecycle([
        { name: HookName['step.begin'], fn: () => {} },
        { name: HookName['step.end'], fn: () => {} },
      ]);
      expect(registry.getLifecycleHooks(HookName['step.begin'])).toHaveLength(1);
      expect(registry.getLifecycleHooks(HookName['step.end'])).toHaveLength(1);
      unreg();
      expect(registry.getLifecycleHooks(HookName['step.begin'])).toHaveLength(0);
      expect(registry.getLifecycleHooks(HookName['step.end'])).toHaveLength(0);
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
      registry.on(HookName['step.begin'], () => {});
      expect(registry.getLifecycleHooks(HookName['step.begin'])).toHaveLength(1);
      registry.clear();
      expect(registry.getLifecycleHooks(HookName['step.begin'])).toHaveLength(0);
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
      registry.on(HookName['step.begin'], () => {});
      registry.registerRequest({ name: 'req', priority: 10, apply: (m) => m });
      registry.registerTool({ name: 'tool', priority: 10, beforeExecute: () => true });
      registry.registerToolProvider({ name: 'prov', priority: 10, filter: (t) => t });

      expect(registry.getLifecycleHooks(HookName['step.begin'])).toHaveLength(1);
      expect(registry.getRequestHooks()).toHaveLength(1);
      expect(registry.getToolHooks()).toHaveLength(1);
      expect(registry.getToolProviderHooks()).toHaveLength(1);

      // clear should remove all
      registry.clear();
      expect(registry.getLifecycleHooks(HookName['step.begin'])).toHaveLength(0);
      expect(registry.getRequestHooks()).toHaveLength(0);
      expect(registry.getToolHooks()).toHaveLength(0);
      expect(registry.getToolProviderHooks()).toHaveLength(0);
    });
  });
});
