import { describe, it, expect } from 'vitest';
import { createRequiredToolsGate } from '../src/harness/required-tools-gate-processor.js';
import type { PipelineContext, ProcessorResult } from '@primo-ai/sdk';

function makeContext(toolDeclarations: Array<{ name: string; description: string }> = []): PipelineContext {
  return {
    request: { input: 'test', sessionId: 's1' },
    agent: { config: { model: 'mock/test' }, promptFragments: [], toolDeclarations },
    iteration: { step: 0 },
    session: { custom: {} },
  } as PipelineContext;
}

function isContext(r: ProcessorResult): r is PipelineContext {
  return 'request' in r && 'agent' in r;
}

function isAbort(r: ProcessorResult): r is { type: 'abort'; reason: string } {
  return typeof r === 'object' && r !== null && 'type' in r && (r as { type: string }).type === 'abort';
}

describe('createRequiredToolsGate', () => {
  it('passes when all required tools are present', async () => {
    const processor = createRequiredToolsGate(['read_file', 'write_file']);
    const ctx = makeContext([
      { name: 'read_file', description: 'Read a file' },
      { name: 'write_file', description: 'Write a file' },
      { name: 'echo', description: 'Echo input' },
    ]);
    const result = await processor.execute(ctx);
    expect(isContext(result)).toBe(true);
  });

  it('aborts when a single required tool is missing', async () => {
    const processor = createRequiredToolsGate(['read_file', 'write_file']);
    const ctx = makeContext([
      { name: 'read_file', description: 'Read a file' },
    ]);
    const result = await processor.execute(ctx);
    expect(isAbort(result)).toBe(true);
    if (isAbort(result)) {
      expect(result.reason).toContain('write_file');
      expect(result.type).toBe('abort');
    }
  });

  it('aborts and lists all missing tools when multiple are absent', async () => {
    const processor = createRequiredToolsGate(['read_file', 'write_file', 'delete_file']);
    const ctx = makeContext([
      { name: 'echo', description: 'Echo input' },
    ]);
    const result = await processor.execute(ctx);
    expect(isAbort(result)).toBe(true);
    if (isAbort(result)) {
      expect(result.reason).toContain('read_file');
      expect(result.reason).toContain('write_file');
      expect(result.reason).toContain('delete_file');
    }
  });

  it('always passes when required tools list is empty', async () => {
    const processor = createRequiredToolsGate([]);
    const ctx = makeContext([]); // no tools at all
    const result = await processor.execute(ctx);
    expect(isContext(result)).toBe(true);
  });

  it('always passes when required tools list is empty even with tools present', async () => {
    const processor = createRequiredToolsGate([]);
    const ctx = makeContext([
      { name: 'read_file', description: 'Read a file' },
    ]);
    const result = await processor.execute(ctx);
    expect(isContext(result)).toBe(true);
  });

  it('registers on processInput stage', () => {
    const processor = createRequiredToolsGate(['tool1']);
    expect(processor.stage).toBe('processInput');
  });

  it('passes context through unchanged when all tools present', async () => {
    const processor = createRequiredToolsGate(['read_file']);
    const ctx = makeContext([
      { name: 'read_file', description: 'Read a file' },
    ]);
    const result = await processor.execute(ctx);
    expect(isContext(result)).toBe(true);
    if (isContext(result)) {
      expect(result.request.sessionId).toBe('s1');
      expect(result.request.input).toBe('test');
    }
  });

  it('handles toolDeclarations with extra tools gracefully', async () => {
    const processor = createRequiredToolsGate(['tool_a']);
    const ctx = makeContext([
      { name: 'tool_a', description: 'A' },
      { name: 'tool_b', description: 'B' },
      { name: 'tool_c', description: 'C' },
    ]);
    const result = await processor.execute(ctx);
    expect(isContext(result)).toBe(true);
  });
});
