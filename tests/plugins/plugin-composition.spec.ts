/**
 * E2E tests for Plugin Composition.
 *
 * Tests multi-plugin coexistence, cross-plugin event communication,
 * and requestHooks+addMessages composition.
 */

import { describe, it, expect } from 'vitest';
import { AgentEventEmitter, type AgentEvent } from '../../src/core/events.js';
import { HookRegistry, type CheckpointPhase, type LifecyclePhase } from '../../src/core/hooks.js';
import { createPluginContext, type Plugin } from '../../src/plugins/plugin.js';
import { applyPlugins } from '../../src/plugins/pipeline.js';
import { createInitialState, type AgentState } from '../../src/core/state.js';

describe('Plugin Composition', () => {
  // Test 1: Three plugins coexist without interference
  it('three plugins coexist without interference', () => {
    const emitter = new AgentEventEmitter();
    const hooks = new HookRegistry();
    const state = createInitialState({
      sessionId: 'comp-test',
      agentName: 'comp-agent',
      model: { provider: 'test', model: 'test-model' },
      initialMessages: [],
      maxSteps: 10,
    });
    const ctx = createPluginContext({
      sessionId: 'comp-test',
      agentName: 'comp-agent',
      emitter,
      getState: () => state,
      listTools: () => [],
      addMessages: () => {},
    });

    const quotaPlugin: Plugin = {
      name: 'quota',
      enabled: true,
      checkpointHooks: [
        {
          name: 'quota-check',
          phase: 'pre-llm' as CheckpointPhase,
          priority: 10,
          check: async () => ({ action: 'continue' as const }),
        },
      ],
    };

    const customPlugin: Plugin = {
      name: 'custom',
      enabled: true,
      requestHooks: [
        {
          name: 'inject-context',
          priority: 20,
          apply: (msgs) => [...msgs, { role: 'system' as const, content: 'injected' }],
        },
      ],
      eventSubscriptions: [
        {
          event: 'llm.request',
          handler: () => {},
        },
      ],
    };

    const loggingPlugin: Plugin = {
      name: 'logging',
      enabled: true,
      lifecycleHooks: [
        {
          phase: 'step.begin' as LifecyclePhase,
          fn: async () => {},
          priority: 100,
        },
      ],
    };

    const pipeline = applyPlugins([quotaPlugin, customPlugin, loggingPlugin], hooks, emitter, ctx);

    const checkpoints = pipeline.getCheckpoints('pre-llm');
    expect(checkpoints).toHaveLength(1);

    const requestHooks = hooks.getRequestHooks();
    expect(requestHooks).toHaveLength(1);
    expect(requestHooks[0]!.name).toBe('inject-context');

    pipeline.unregister();
  });

  // Test 2: Plugin A events reach plugin B
  it('plugin A events reach plugin B', async () => {
    const emitter = new AgentEventEmitter();
    const hooks = new HookRegistry();
    const received: AgentEvent[] = [];
    const ctx = createPluginContext({
      sessionId: 's1',
      agentName: 'a1',
      emitter,
      getState: () =>
        createInitialState({
          sessionId: 's1',
          agentName: 'a1',
          model: { provider: 't', model: 'm' },
          initialMessages: [],
          maxSteps: 10,
        }),
      listTools: () => [],
      addMessages: () => {},
    });

    const pluginB: Plugin = {
      name: 'observer',
      enabled: true,
      eventSubscriptions: [
        {
          event: 'state.change',
          handler: (e) => {
            received.push(e);
          },
        },
      ],
    };

    applyPlugins([pluginB], hooks, emitter, ctx);

    await ctx.emitter.emit({
      type: 'state.change',
      timestamp: Date.now(),
      sessionId: 's1',
      from: 'running',
      to: 'paused',
    });

    expect(received).toHaveLength(1);
    expect(received[0]!.type).toBe('state.change');
  });

  // Test 3: addMessages and requestHooks compose correctly
  it('addMessages and requestHooks compose correctly', () => {
    const emitter = new AgentEventEmitter();
    const hooks = new HookRegistry();
    const localState = createInitialState({
      sessionId: 's1',
      agentName: 'a1',
      model: { provider: 't', model: 'm' },
      initialMessages: [],
      maxSteps: 10,
    });

    const ctx = createPluginContext({
      sessionId: 's1',
      agentName: 'a1',
      emitter,
      getState: () => localState,
      listTools: () => [],
      addMessages: (m) => {
        localState.messages.push(...m);
      },
    });

    const plugin: Plugin = {
      name: 'workflow',
      enabled: true,
      requestHooks: [
        {
          name: 'dedup',
          priority: 10,
          apply: (msgs) => {
            const seen = new Set<string>();
            return msgs.filter((m) => {
              if (m.role !== 'system') return true;
              const key = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
              if (seen.has(key)) return false;
              seen.add(key);
              return true;
            });
          },
        },
      ],
    };

    applyPlugins([plugin], hooks, emitter, ctx);

    ctx.addMessages([{ role: 'system', content: 'Step 1' }]);
    ctx.addMessages([{ role: 'system', content: 'Step 2' }]);
    ctx.addMessages([{ role: 'system', content: 'Step 1' }]); // duplicate

    const result = hooks.getRequestHooks()[0]!.apply(localState.messages, localState);
    const systemMessages = result.filter((m: { role: string }) => m.role === 'system');
    expect(systemMessages).toHaveLength(2);
  });
});
