import { describe, it, expect } from 'vitest';
import { PipelineRunner } from '../src/pipeline.js';
import { EventBus } from '../src/event-bus.js';
import type { PipelineContext, Processor, ContextModificationRecord } from '@primo-ai/sdk';
import { ProcessorContextImpl } from '../src/processor-context.js';
import { freezeContext, deepFreezeContext } from '../src/pipeline.js';

function makeContext(overrides?: Partial<PipelineContext>): PipelineContext {
  return {
    agent: { config: { model: 'mock/test' }, promptFragments: [], toolDeclarations: [] },
    iteration: { step: 0 },
    session: { input: 'test', sessionId: 's1', custom: {} },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Part 1: Modification Tracking
// ---------------------------------------------------------------------------
describe('Modification Tracking', () => {
  it('records modification with processor name and timestamp when setState is called', () => {
    const ctx = new ProcessorContextImpl(makeContext());
    ctx._processorName = 'testProcessor';
    const before = Date.now();

    ctx.setState('testProcessor.key', 'value');

    const mods = ctx.getModifications();
    expect(mods).toHaveLength(1);
    expect(mods[0].processor).toBe('testProcessor');
    expect(mods[0].field).toBe('testProcessor.key');
    expect(mods[0].timestamp).toBeGreaterThanOrEqual(before);
    expect(mods[0].previousValue).toBeUndefined();
  });

  it('records previousValue when overwriting an existing key', () => {
    const ctx = new ProcessorContextImpl(makeContext());
    ctx._processorName = 'proc1';
    ctx.setState('proc1.key', 'first');

    ctx._processorName = 'proc2';
    ctx.setState('proc2.key', 'second');

    const mods = ctx.getModifications();
    expect(mods).toHaveLength(2);
    // The second set uses a different key (proc2.key), so previousValue is undefined for that key
    // Let's test overwrite on same key
  });

  it('records previousValue when overwriting the same key', () => {
    const ctx = new ProcessorContextImpl(makeContext());
    ctx._processorName = 'myPlugin';
    ctx.setState('myPlugin.key', 'first');

    ctx._processorName = 'myPlugin';
    ctx.setState('myPlugin.key', 'second');

    const mods = ctx.getModifications();
    expect(mods).toHaveLength(2);
    expect(mods[1].previousValue).toBe('first');
    expect(mods[1].processor).toBe('myPlugin');
  });

  it('getModifications returns all recorded changes', () => {
    const ctx = new ProcessorContextImpl(makeContext());
    ctx._processorName = 'procA';
    ctx.setState('procA.alpha', 1);
    ctx.setState('procA.beta', 2);
    ctx.setState('procA.gamma', 3);

    const mods = ctx.getModifications();
    expect(mods).toHaveLength(3);
    expect(mods.map((m) => m.field)).toEqual(['procA.alpha', 'procA.beta', 'procA.gamma']);
  });

  it('emits context:modified event on modifications during pipeline execution', async () => {
    const eventBus = new EventBus();
    const runner = new PipelineRunner({ eventBus });
    const emitted: unknown[] = [];
    eventBus.subscribe('context:modified', (data) => emitted.push(data));

    // Using built-in stage name so namespace validation is exempted
    runner.register({
      stage: 'processInput',
      execute: async (pCtx) => {
        (pCtx as ProcessorContextImpl).setState('myPlugin.key', 'value');
      },
    });

    await runner.run(makeContext(), ['processInput']);

    expect(emitted.length).toBeGreaterThanOrEqual(1);
    const lastEmit = emitted[emitted.length - 1] as { modifications: ContextModificationRecord[] };
    expect(lastEmit.modifications.length).toBeGreaterThanOrEqual(1);
    expect(lastEmit.modifications[0].field).toBe('myPlugin.key');
  });

  it('stores modifications in PipelineContext.__modifications', async () => {
    const runner = new PipelineRunner();
    runner.register({
      stage: 'processInput',
      execute: async (pCtx) => {
        (pCtx as ProcessorContextImpl).setState('ns.x', 42);
      },
    });

    const result = await runner.run(makeContext(), ['processInput']);
    const ctx = 'type' in result ? null : result;
    expect(ctx).not.toBeNull();
    expect((ctx as PipelineContext).__modifications).toBeDefined();
    expect((ctx as PipelineContext).__modifications!.length).toBeGreaterThanOrEqual(1);
    expect((ctx as PipelineContext).__modifications![0].field).toBe('ns.x');
  });
});

// ---------------------------------------------------------------------------
// Part 2: Namespace Isolation
// ---------------------------------------------------------------------------
describe('Namespace Isolation', () => {
  it('accepts dot-separated namespace prefixes', () => {
    const ctx = new ProcessorContextImpl(makeContext());
    ctx._processorName = 'myPlugin';
    expect(() => ctx.setState('myPlugin.key', 'value')).not.toThrow();
    expect(ctx.getState('myPlugin.key')).toBe('value');
  });

  it('rejects non-prefixed keys from plugins (no dot in namespace)', () => {
    const ctx = new ProcessorContextImpl(makeContext());
    ctx._processorName = 'myPlugin';
    expect(() => ctx.setState('bareKey', 'value')).toThrow(/[Nn]amespace/);
  });

  it('allows built-in processors to use non-prefixed keys', () => {
    const ctx = new ProcessorContextImpl(makeContext());
    ctx._processorName = 'invokeLLM';
    expect(() => ctx.setState('invokeLLMState', 'value')).not.toThrow();
  });

  it('requires plugin namespace prefix to match processor name', () => {
    const ctx = new ProcessorContextImpl(makeContext());
    ctx._processorName = 'myPlugin';
    // myPlugin.key starts with "myPlugin" so prefix matches
    expect(() => ctx.setState('myPlugin.key', 'value')).not.toThrow();
    // otherPlugin.key does NOT match processor name "myPlugin"
    expect(() => ctx.setState('otherPlugin.key', 'value')).toThrow(/[Nn]amespace/);
  });

  it('getNamespaces returns all used namespaces', () => {
    const ctx = new ProcessorContextImpl(makeContext());
    ctx._processorName = 'myPlugin';
    ctx.setState('myPlugin.key1', 'a');
    ctx.setState('myPlugin.key2', 'b');

    const namespaces = ctx.getNamespaces();
    expect(namespaces).toContain('myPlugin');
  });
});

// ---------------------------------------------------------------------------
// Part 3: Freeze Utilities
// ---------------------------------------------------------------------------
describe('Freeze Utilities', () => {
  it('freezeContext() prevents top-level mutations on PipelineContext', () => {
    const ctx = makeContext();
    const frozen = freezeContext(ctx);
    expect(Object.isFrozen(frozen)).toBe(true);
    expect(() => { (frozen as unknown as Record<string, unknown>).agent = {} as PipelineContext['agent']; }).toThrow();
  });

  it('deepFreezeContext() prevents nested mutations on PipelineContext', () => {
    const ctx = makeContext();
    const frozen = deepFreezeContext(ctx);
    expect(Object.isFrozen(frozen)).toBe(true);
    expect(Object.isFrozen(frozen.session)).toBe(true);
    expect(Object.isFrozen(frozen.session.custom)).toBe(true);
    expect(() => { (frozen.session.custom as Record<string, unknown>).newKey = 'nope'; }).toThrow();
  });

  it('frozen context can still be read', () => {
    const ctx = makeContext({ session: { input: 'hello', sessionId: 's1', custom: { key: 'val' } } });
    const frozen = deepFreezeContext(ctx);
    expect(frozen.session.input).toBe('hello');
    expect(frozen.session.custom.key).toBe('val');
  });

  it('freeze() and deepFreeze() methods are attached on frozen context', () => {
    const ctx = makeContext();
    const frozen = freezeContext(ctx);
    expect(typeof frozen.freeze).toBe('function');
    expect(typeof frozen.deepFreeze).toBe('function');
  });
});
