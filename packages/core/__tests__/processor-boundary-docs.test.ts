import { describe, it, expect } from 'vitest';
import type { Processor, Hook } from '@primo-ai/sdk';

describe('Processor and Hook types are distinct', () => {
  it('Processor has execute method returning ProcessorResult', () => {
    const processor: Processor = {
      stage: 'processInput',
      execute: async (ctx) => ctx,
    };
    expect(processor.execute).toBeDefined();
    expect(typeof processor.execute).toBe('function');
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
      execute: async (ctx) => ctx,
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
});
