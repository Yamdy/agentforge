import { describe, it, expect } from 'vitest';
import type { Processor, Hook, ProcessorContext } from '@primo-ai/sdk';
import { ProcessorContextImpl } from '../src/processor-context.js';

function makeProcessorContext(): ProcessorContext {
  return new ProcessorContextImpl({
    request: { input: 'test', sessionId: 's1' },
    agent: { config: { model: 'test' }, promptFragments: [], toolDeclarations: [] },
    iteration: { step: 0 },
    session: { custom: {} },
  });
}

describe('Processor and Hook types are distinct', () => {
  it('Processor has execute method returning void or context', async () => {
    const processor: Processor = {
      stage: 'processInput',
      execute: async (ctx) => {
        // Can modify state directly
        ctx.state.request.input = 'modified';
        // Or return void
      },
    };
    expect(processor.execute).toBeDefined();
    expect(typeof processor.execute).toBe('function');

    // Test execution
    const pCtx = makeProcessorContext();
    await processor.execute(pCtx);
    expect(pCtx.state.request.input).toBe('modified');
  });

  it('Hook has handler method, not execute', () => {
    const hook: Hook = {
      point: 'llm.before',
      handler: (input, output) => {},
    };
    expect(hook.handler).toBeDefined();
    expect(typeof hook.handler).toBe('function');
    // Hook should not have execute property
    expect((hook as any).execute).toBeUndefined();
  });

  it('Processor can have isNoOp flag', () => {
    const processor: Processor = {
      stage: 'processStepOutput',
      execute: async () => {},
      isNoOp: true,
    };
    expect(processor.isNoOp).toBe(true);
  });

  it('Hook can have optional name and priority', () => {
    const hook: Hook = {
      point: 'tool.after',
      name: 'audit-log',
      handler: (input, output) => {},
      priority: 10,
    };
    expect(hook.name).toBe('audit-log');
    expect(hook.priority).toBe(10);
  });

  it('Processor can abort via control API', async () => {
    const processor: Processor = {
      stage: 'processInput',
      execute: async (ctx) => {
        ctx.control.abort('test abort reason');
      },
    };

    const pCtx = makeProcessorContext();
    await expect(async () => {
      await processor.execute(pCtx);
    }).rejects.toThrow('test abort reason');
  });
});
