import { describe, it, expect } from 'vitest';
import { createRequiredToolsGate } from '../src/harness/required-tools-gate-processor.js';
import type { PipelineContext, ProcessorContext } from '@primo-ai/sdk';
import { ProcessorContextImpl, AbortControlFlow } from '@primo-ai/core';

function makeContext(toolDeclarations: Array<{ name: string; description: string }> = []): PipelineContext {
  return {
    agent: { config: { model: 'mock/test' }, promptFragments: [], toolDeclarations },
    iteration: { step: 0 },
    session: { input: 'test', sessionId: 's1', custom: {} },
  } as PipelineContext;
}

function makeProcessorContext(toolDeclarations: Array<{ name: string; description: string }> = []): ProcessorContext {
  return new ProcessorContextImpl(makeContext(toolDeclarations));
}

async function expectAbort(pCtx: ProcessorContext, processor: { execute: (ctx: ProcessorContext) => Promise<unknown> }): Promise<string> {
  try {
    await processor.execute(pCtx);
    throw new Error('Expected abort but processor returned normally');
  } catch (error) {
    if (error instanceof AbortControlFlow) {
      return error.reason;
    }
    throw error;
  }
}

describe('createRequiredToolsGate', () => {
  it('passes when all required tools are present', async () => {
    const processor = createRequiredToolsGate(['read_file', 'write_file']);
    const pCtx = makeProcessorContext([
      { name: 'read_file', description: 'Read a file' },
      { name: 'write_file', description: 'Write a file' },
      { name: 'echo', description: 'Echo input' },
    ]);
    await processor.execute(pCtx);
    // No abort = passed
  });

  it('aborts when a single required tool is missing', async () => {
    const processor = createRequiredToolsGate(['read_file', 'write_file']);
    const pCtx = makeProcessorContext([
      { name: 'read_file', description: 'Read a file' },
    ]);
    const reason = await expectAbort(pCtx, processor);
    expect(reason).toContain('write_file');
  });

  it('aborts and lists all missing tools when multiple are absent', async () => {
    const processor = createRequiredToolsGate(['read_file', 'write_file', 'delete_file']);
    const pCtx = makeProcessorContext([
      { name: 'echo', description: 'Echo input' },
    ]);
    const reason = await expectAbort(pCtx, processor);
    expect(reason).toContain('read_file');
    expect(reason).toContain('write_file');
    expect(reason).toContain('delete_file');
  });

  it('always passes when required tools list is empty', async () => {
    const processor = createRequiredToolsGate([]);
    const pCtx = makeProcessorContext([]); // no tools at all
    await processor.execute(pCtx);
    // No abort = passed
  });

  it('always passes when required tools list is empty even with tools present', async () => {
    const processor = createRequiredToolsGate([]);
    const pCtx = makeProcessorContext([
      { name: 'read_file', description: 'Read a file' },
    ]);
    await processor.execute(pCtx);
    // No abort = passed
  });

  it('registers on processInput stage', () => {
    const processor = createRequiredToolsGate(['tool1']);
    expect(processor.stage).toBe('processInput');
  });

  it('passes context through unchanged when all tools present', async () => {
    const processor = createRequiredToolsGate(['read_file']);
    const pCtx = makeProcessorContext([
      { name: 'read_file', description: 'Read a file' },
    ]);
    await processor.execute(pCtx);
    expect(pCtx.state.session.sessionId).toBe('s1');
    expect(pCtx.state.session.input).toBe('test');
  });

  it('handles toolDeclarations with extra tools gracefully', async () => {
    const processor = createRequiredToolsGate(['tool_a']);
    const pCtx = makeProcessorContext([
      { name: 'tool_a', description: 'A' },
      { name: 'tool_b', description: 'B' },
      { name: 'tool_c', description: 'C' },
    ]);
    await processor.execute(pCtx);
    // No abort = passed
  });
});
