import { describe, it, expect } from 'vitest';
import { permissionPlugin, createPermissionProcessor, type PermissionDecisionEvent } from '../src/permission/index.js';
import type { HarnessAPI, PipelineContext } from '@agentforge/sdk';

function createHarnessAPI(): { api: HarnessAPI; processors: Map<string, unknown>; emitted: Array<{ type: string; data: unknown }> } {
  const processors = new Map<string, unknown>();
  const emitted: Array<{ type: string; data: unknown }> = [];

  const api: HarnessAPI = {
    registerProcessor: (stage, processor) => { processors.set(stage, processor); },
    registerTool: () => {},
    unregisterTool: () => false,
    registerCommand: () => {},
    registerHook: () => {},
    subscribe: () => () => {},
    registerResource: () => {},
    registerProvider: () => {},
    emit: (type, data) => { emitted.push({ type, data }); },
  };

  return { api, processors, emitted };
}

function makeContext(overrides?: Partial<PipelineContext>): PipelineContext {
  return {
    request: { input: 'test', sessionId: 'session-1' },
    agent: { config: { model: 'mock/test' }, promptFragments: [], toolDeclarations: [] },
    iteration: { step: 0 },
    session: { custom: {} },
    ...overrides,
  };
}

function isAbort(result: PipelineContext | { type: 'abort'; reason: string }): result is { type: 'abort'; reason: string } {
  return 'type' in result && result.type === 'abort';
}

describe('permissionPlugin', () => {
  it('registers a processor at beforeTool stage', () => {
    const { api, processors } = createHarnessAPI();

    permissionPlugin({
      mode: 'plan-only',
      rules: [],
    })(api);

    expect(processors.has('beforeTool')).toBe(true);
  });

  it('returns PluginRegistration with the processor', () => {
    const { api } = createHarnessAPI();

    const registration = permissionPlugin({
      mode: 'interactive',
      rules: [{ tool: 'shell_exec', action: 'deny' }],
    })(api);

    expect(registration.processors).toBeDefined();
    expect(registration.processors!.length).toBeGreaterThanOrEqual(1);
    expect(registration.processors![0].stage).toBe('beforeTool');
  });

  it('processor from plugin denies tools in plan-only mode', async () => {
    const { api, processors } = createHarnessAPI();

    permissionPlugin({
      mode: 'plan-only',
      rules: [],
    })(api);

    const processor = processors.get('beforeTool') as { stage: string; execute: (ctx: PipelineContext) => Promise<unknown> };
    expect(processor).toBeDefined();

    const ctx = makeContext({
      iteration: { step: 0, pendingToolCalls: [{ id: 'call_1', name: 'shell_exec', args: { command: 'ls' } }] },
    });

    const result = await processor.execute(ctx);
    expect(isAbort(result)).toBe(true);
  });

  it('processor from plugin allows tools in full-auto mode', async () => {
    const { api, processors } = createHarnessAPI();

    permissionPlugin({
      mode: 'full-auto',
      rules: [],
    })(api);

    const processor = processors.get('beforeTool') as { stage: string; execute: (ctx: PipelineContext) => Promise<unknown> };
    expect(processor).toBeDefined();

    const ctx = makeContext({
      iteration: { step: 0, pendingToolCalls: [{ id: 'call_1', name: 'shell_exec', args: { command: 'rm -rf /' } }] },
    });

    const result = await processor.execute(ctx);
    expect(isAbort(result)).toBe(false);
  });

  it('emits permission.decision event via api.emit when deny rule triggers', async () => {
    const { api, processors, emitted } = createHarnessAPI();

    permissionPlugin({
      mode: 'plan-only',
      rules: [{ tool: 'shell_exec', action: 'deny' }],
    })(api);

    const processor = processors.get('beforeTool') as { stage: string; execute: (ctx: PipelineContext) => Promise<unknown> };
    const ctx = makeContext({
      iteration: { step: 0, pendingToolCalls: [{ id: 'call_1', name: 'shell_exec', args: { command: 'ls' } }] },
    });

    await processor.execute(ctx);

    expect(emitted).toHaveLength(1);
    expect(emitted[0].type).toBe('permission.decision');
    expect(emitted[0].data).toMatchObject({
      decision: 'deny',
      toolName: 'shell_exec',
      rule: 'shell_exec',
      mode: 'plan-only',
    });
  });

  it('emits permission.decision event for allow decisions in interactive mode', async () => {
    const { api, processors, emitted } = createHarnessAPI();

    permissionPlugin({
      mode: 'interactive',
      rules: [],
    })(api);

    const processor = processors.get('beforeTool') as { stage: string; execute: (ctx: PipelineContext) => Promise<unknown> };
    const ctx = makeContext({
      iteration: { step: 0, pendingToolCalls: [{ id: 'call_1', name: 'read_file', args: { path: '/tmp/x' } }] },
    });

    await processor.execute(ctx);

    expect(emitted).toHaveLength(1);
    expect(emitted[0].type).toBe('permission.decision');
    expect(emitted[0].data).toMatchObject({
      decision: 'allow',
      toolName: 'read_file',
      mode: 'interactive',
    });
  });

  it('onDecision callback captures audit events during processor execution', async () => {
    const decisions: PermissionDecisionEvent[] = [];
    const processor = createPermissionProcessor({
      mode: 'interactive',
      rules: [{ tool: 'shell_exec', action: 'deny' }],
      onDecision: (event) => decisions.push(event),
    });

    const ctx = makeContext({
      iteration: { step: 0, pendingToolCalls: [{ id: 'call_1', name: 'shell_exec', args: { command: 'ls' } }] },
    });

    await processor.execute(ctx);

    expect(decisions).toHaveLength(1);
    expect(decisions[0].decision).toBe('deny');
    expect(decisions[0].toolName).toBe('shell_exec');
    expect(decisions[0].rule).toBe('shell_exec');
  });
});
