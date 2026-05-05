/**
 * E2E scenarios for the expanded Plugin API.
 *
 * Tests mini-workflow built purely via Plugin API, state observation,
 * and tool listing integration.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { AgentEventEmitter } from '../../src/core/events.js';
import { HookRegistry, type LifecyclePhase } from '../../src/core/hooks.js';
import { createPluginContext, type Plugin } from '../../src/plugins/plugin.js';
import { applyPlugins } from '../../src/plugins/pipeline.js';
import { createInitialState, type AgentState } from '../../src/core/state.js';
import type { ToolDefinition } from '../../src/core/interfaces.js';

describe('Plugin API: Mini-workflow as Plugin', () => {
  let emitter: AgentEventEmitter;
  let hooks: HookRegistry;
  let state: AgentState;

  beforeEach(() => {
    emitter = new AgentEventEmitter();
    hooks = new HookRegistry();
    state = createInitialState({
      sessionId: 'wf-test',
      agentName: 'wf-agent',
      model: { provider: 'test', model: 'test-model' },
      initialMessages: [{ role: 'user', content: 'Build a calculator' }],
      maxSteps: 10,
    });
  });

  it('workflow plugin emits step events that observer receives', async () => {
    const stepEvents: Array<{ step: number }> = [];
    const ctx = createPluginContext({
      sessionId: 'wf-test',
      agentName: 'wf-agent',
      emitter,
      getState: () => state,
      listTools: () => [],
      addMessages: () => {},
    });

    const workflowPlugin: Plugin = {
      name: 'mini-workflow',
      enabled: true,
      state: { currentStep: 0 },
      lifecycleHooks: [
        {
          phase: 'step.begin' as LifecyclePhase,
          fn: async (_input: unknown, _output: unknown) => {
            const pluginState = workflowPlugin.state as { currentStep: number };
            pluginState.currentStep++;
          },
          priority: 10,
        },
      ],
    };

    const observerPlugin: Plugin = {
      name: 'observer',
      enabled: true,
      eventSubscriptions: [
        {
          event: 'state.change',
          handler: (event) => {
            if (event.checkpoint) {
              stepEvents.push({ step: parseInt(event.checkpoint.id.split('-')[1]!) });
            }
          },
        },
      ],
    };

    applyPlugins([workflowPlugin, observerPlugin], hooks, emitter, ctx);

    // Simulate 3 steps
    for (let i = 0; i < 3; i++) {
      state.step = i;
      // Emit a custom event from the workflow plugin
      await ctx.emitter.emit({
        type: 'state.change',
        timestamp: Date.now(),
        sessionId: 'wf-test',
        from: 'running',
        to: 'running',
        checkpoint: { id: `step-${i + 1}`, position: 'before_llm' },
      });
      // Run lifecycle hooks
      const fns = hooks.getLifecycleHooks('step.begin');
      for (const fn of fns) {
        await fn({ step: i }, {});
      }
    }

    expect(stepEvents).toHaveLength(3);
    expect(stepEvents.map((e) => e.step)).toEqual([1, 2, 3]);
  });

  it('getState reflects current step in lifecycle hook', async () => {
    const observedSteps: number[] = [];
    const ctx = createPluginContext({
      sessionId: 'wf-test',
      agentName: 'wf-agent',
      emitter,
      getState: () => state,
      listTools: () => [],
      addMessages: () => {},
    });

    const plugin: Plugin = {
      name: 'state-reader',
      enabled: true,
      lifecycleHooks: [
        {
          phase: 'step.begin' as LifecyclePhase,
          fn: async () => {
            observedSteps.push(ctx.getState().step);
          },
          priority: 10,
        },
      ],
    };

    applyPlugins([plugin], hooks, emitter, ctx);

    for (let i = 0; i < 5; i++) {
      state.step = i;
      const fns = hooks.getLifecycleHooks('step.begin');
      for (const fn of fns) {
        await fn({ step: i }, {});
      }
    }

    expect(observedSteps).toEqual([0, 1, 2, 3, 4]);
  });

  it('listTools returns registered tools', () => {
    const tools: ToolDefinition[] = [
      {
        name: 'read_file',
        description: 'Read a file',
        parameters: {},
        execute: async () => 'ok',
      },
      {
        name: 'write_file',
        description: 'Write a file',
        parameters: {},
        execute: async () => 'ok',
      },
    ];

    const ctx = createPluginContext({
      sessionId: 'wf-test',
      agentName: 'wf-agent',
      emitter,
      getState: () => state,
      listTools: () => tools,
      addMessages: () => {},
    });

    const result = ctx.listTools();
    expect(result).toHaveLength(2);
    expect(result.map((t) => t.name)).toEqual(['read_file', 'write_file']);
  });
});
