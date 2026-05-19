import { describe, it, expect } from 'vitest';
import { permissionPlugin, createPermissionProcessor, type PermissionDecisionEvent } from '../src/permission/index.js';
import type { HarnessAPI, PipelineContext, Processor } from '@primo-ai/sdk';
import { ProcessorContextImpl, AbortControlFlow, SuspendControlFlow } from '@primo-ai/core';

function createHarnessAPI(): { api: HarnessAPI; processors: Map<string, Processor>; emitted: Array<{ type: string; data: unknown }> } {
  const processors = new Map<string, Processor>();
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

async function executeProcessor(processor: Processor, ctx: PipelineContext): Promise<{ type: 'ok' | 'abort' | 'suspend'; reason?: string; suspensionId?: string }> {
  const pCtx = new ProcessorContextImpl(ctx);
  try {
    await processor.execute(pCtx);
    return { type: 'ok' };
  } catch (e) {
    if (e instanceof AbortControlFlow) {
      return { type: 'abort', reason: e.reason };
    }
    if (e instanceof SuspendControlFlow) {
      return { type: 'suspend', reason: e.reason, suspensionId: e.suspensionId };
    }
    throw e;
  }
}

describe('permissionPlugin', () => {
  it('registers a processor at gateTool stage', () => {
    const { api, processors } = createHarnessAPI();

    permissionPlugin({
      mode: 'plan-only',
      rules: [],
    })(api);

    expect(processors.has('gateTool')).toBe(true);
  });

  it('returns PluginRegistration with the processor', () => {
    const { api } = createHarnessAPI();

    const registration = permissionPlugin({
      mode: 'interactive',
      rules: [{ tool: 'shell_exec', action: 'deny' }],
    })(api);

    expect(registration.processors).toBeDefined();
    expect(registration.processors!.length).toBeGreaterThanOrEqual(1);
    expect(registration.processors![0].stage).toBe('gateTool');
  });

  it('processor from plugin denies tools in plan-only mode', async () => {
    const { api, processors } = createHarnessAPI();

    permissionPlugin({
      mode: 'plan-only',
      rules: [],
    })(api);

    const processor = processors.get('gateTool');
    expect(processor).toBeDefined();

    const ctx = makeContext({
      iteration: { step: 0, pendingToolCalls: [{ id: 'call_1', name: 'shell_exec', args: { command: 'ls' } }] },
    });

    const result = await executeProcessor(processor!, ctx);
    expect(result.type).toBe('abort');
  });

  it('processor from plugin allows tools in full-auto mode', async () => {
    const { api, processors } = createHarnessAPI();

    permissionPlugin({
      mode: 'full-auto',
      rules: [],
    })(api);

    const processor = processors.get('gateTool');
    expect(processor).toBeDefined();

    const ctx = makeContext({
      iteration: { step: 0, pendingToolCalls: [{ id: 'call_1', name: 'shell_exec', args: { command: 'rm -rf /' } }] },
    });

    const result = await executeProcessor(processor!, ctx);
    expect(result.type).toBe('ok');
  });

  it('emits permission.decision event via api.emit when deny rule triggers', async () => {
    const { api, processors, emitted } = createHarnessAPI();

    permissionPlugin({
      mode: 'plan-only',
      rules: [{ tool: 'shell_exec', action: 'deny' }],
    })(api);

    const processor = processors.get('gateTool');
    const ctx = makeContext({
      iteration: { step: 0, pendingToolCalls: [{ id: 'call_1', name: 'shell_exec', args: { command: 'ls' } }] },
    });

    await executeProcessor(processor!, ctx);

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

    const processor = processors.get('gateTool');
    const ctx = makeContext({
      iteration: { step: 0, pendingToolCalls: [{ id: 'call_1', name: 'read_file', args: { path: '/tmp/x' } }] },
    });

    await executeProcessor(processor!, ctx);

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

    await executeProcessor(processor, ctx);

    expect(decisions).toHaveLength(1);
    expect(decisions[0].decision).toBe('deny');
    expect(decisions[0].toolName).toBe('shell_exec');
    expect(decisions[0].rule).toBe('shell_exec');
  });

  it('ask rule in interactive mode returns SuspendSignal (not abort)', async () => {
    const processor = createPermissionProcessor({
      mode: 'interactive',
      rules: [{ tool: 'shell_exec', action: 'ask' }],
      onDecision: () => {},
    });

    const ctx = makeContext({
      iteration: { step: 0, pendingToolCalls: [{ id: 'call_1', name: 'shell_exec', args: { command: 'ls' } }] },
    });

    const result = await executeProcessor(processor, ctx);

    // Must return suspend signal, not abort
    expect(result.type).toBe('suspend');
    expect(result.suspensionId).toContain('perm-shell_exec');
  });

  it('ask rule in plan-only mode still returns abort (treated as deny)', async () => {
    const processor = createPermissionProcessor({
      mode: 'plan-only',
      rules: [{ tool: 'shell_exec', action: 'ask' }],
      onDecision: () => {},
    });

    const ctx = makeContext({
      iteration: { step: 0, pendingToolCalls: [{ id: 'call_1', name: 'shell_exec', args: { command: 'ls' } }] },
    });

    const result = await executeProcessor(processor, ctx);

    // plan-only treats ask as deny → abort
    expect(result.type).toBe('abort');
  });

  it('ask rule emits decision event with decision=ask', async () => {
    const decisions: PermissionDecisionEvent[] = [];
    const processor = createPermissionProcessor({
      mode: 'interactive',
      rules: [{ tool: 'file_write', action: 'ask' }],
      onDecision: (event) => decisions.push(event),
    });

    const ctx = makeContext({
      iteration: { step: 0, pendingToolCalls: [{ id: 'call_1', name: 'file_write', args: { path: '/etc/passwd' } }] },
    });

    await executeProcessor(processor, ctx);

    expect(decisions).toHaveLength(1);
    expect(decisions[0].decision).toBe('ask');
    expect(decisions[0].toolName).toBe('file_write');
  });
});
