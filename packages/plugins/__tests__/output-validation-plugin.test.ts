import { describe, it, expect } from 'vitest';
import {
  createOutputValidationProcessor,
  type OutputValidationConfig,
} from '../src/validation/output-validation-plugin.js';
import type { PipelineContext, Processor } from '@primo-ai/sdk';
import { ProcessorContextImpl, AbortControlFlow } from '@primo-ai/core';

function makeContext(response?: string, overrides?: Partial<PipelineContext>): PipelineContext {
  return {
    request: { input: 'test', sessionId: 'session-1' },
    agent: { config: { model: 'test' }, promptFragments: [], toolDeclarations: [] },
    iteration: { step: 0, response },
    session: { custom: {} },
    ...overrides,
  };
}

async function executeProcessor(processor: Processor, ctx: PipelineContext): Promise<{ type: 'ok' | 'abort'; reason?: string; ctx?: PipelineContext }> {
  const pCtx = new ProcessorContextImpl(ctx);
  try {
    await processor.execute(pCtx);
    return { type: 'ok', ctx: pCtx.state };
  } catch (e) {
    if (e instanceof AbortControlFlow) {
      return { type: 'abort', reason: e.reason };
    }
    throw e;
  }
}

describe('createOutputValidationProcessor', () => {
  // ---------------------------------------------------------------------------
  // JSON Schema validation
  // ---------------------------------------------------------------------------
  describe('JSON Schema validation', () => {
    const config: OutputValidationConfig = {
      type: 'json-schema',
      schema: {
        type: 'object',
        required: ['name', 'age'],
        properties: {
          name: { type: 'string' },
          age: { type: 'number' },
        },
      },
      strategy: 'block',
    };

    it('passes valid JSON responses that match the schema', async () => {
      const processor = createOutputValidationProcessor(config);
      const ctx = makeContext(JSON.stringify({ name: 'Alice', age: 30 }));
      const result = await executeProcessor(processor, ctx);
      // Should return ok (not an abort)
      expect(result.type).toBe('ok');
    });

    it('blocks invalid JSON responses with block strategy', async () => {
      const processor = createOutputValidationProcessor(config);
      const ctx = makeContext(JSON.stringify({ name: 'Alice' })); // missing 'age'
      const result = await executeProcessor(processor, ctx);
      expect(result.type).toBe('abort');
      expect(result.reason).toContain('Output validation failed');
    });

    it('blocks non-JSON responses when schema is expected', async () => {
      const processor = createOutputValidationProcessor(config);
      const ctx = makeContext('not json at all');
      const result = await executeProcessor(processor, ctx);
      expect(result.type).toBe('abort');
      expect(result.reason).toContain('Output validation failed');
    });

    it('passes when there is no response', async () => {
      const processor = createOutputValidationProcessor(config);
      const ctx = makeContext(undefined);
      const result = await executeProcessor(processor, ctx);
      expect(result.type).toBe('ok');
    });
  });

  // ---------------------------------------------------------------------------
  // Strategy: warn
  // ---------------------------------------------------------------------------
  describe('warn strategy', () => {
    const config: OutputValidationConfig = {
      type: 'json-schema',
      schema: {
        type: 'object',
        required: ['status'],
        properties: {
          status: { type: 'string' },
        },
      },
      strategy: 'warn',
    };

    it('passes through invalid responses with warn strategy (logs warning)', async () => {
      const warnings: string[] = [];
      const originalWarn = console.warn;
      console.warn = (...args: unknown[]) => warnings.push(args.join(' '));

      const processor = createOutputValidationProcessor(config);
      const ctx = makeContext(JSON.stringify({ wrong: true }));
      const result = await executeProcessor(processor, ctx);

      console.warn = originalWarn;

      // Should NOT abort — just warn
      expect(result.type).toBe('ok');
      expect(warnings.length).toBeGreaterThan(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Strategy: fix
  // ---------------------------------------------------------------------------
  describe('fix strategy', () => {
    const config: OutputValidationConfig = {
      type: 'json-schema',
      schema: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string' },
          age: { type: 'number' },
        },
      },
      strategy: 'fix',
    };

    it('attempts to fix invalid JSON by stripping extra fields', async () => {
      const processor = createOutputValidationProcessor(config);
      const ctx = makeContext(JSON.stringify({ name: 'Bob', extra: 'field' }));
      const result = await executeProcessor(processor, ctx);

      // Fix strategy should pass through since the required fields are present
      expect(result.type).toBe('ok');
      expect(result.ctx?.iteration.response).toBeDefined();
    });

    it('aborts if fix cannot make the response valid', async () => {
      const processor = createOutputValidationProcessor(config);
      const ctx = makeContext('not json');
      const result = await executeProcessor(processor, ctx);
      expect(result.type).toBe('abort');
      expect(result.reason).toContain('Output validation failed');
    });
  });

  // ---------------------------------------------------------------------------
  // Zod schema validation
  // ---------------------------------------------------------------------------
  describe('Zod schema validation', () => {
    it('validates responses against a Zod schema', async () => {
      // Import z from zod
      const { z } = await import('zod');
      const schema = z.object({
        name: z.string(),
        age: z.number(),
      });

      const config: OutputValidationConfig = {
        type: 'zod',
        schema,
        strategy: 'block',
      };

      const processor = createOutputValidationProcessor(config);
      const ctx = makeContext(JSON.stringify({ name: 'Alice', age: 30 }));
      const result = await executeProcessor(processor, ctx);
      expect(result.type).toBe('ok');
    });

    it('blocks responses that fail Zod validation', async () => {
      const { z } = await import('zod');
      const schema = z.object({
        name: z.string(),
        age: z.number(),
      });

      const config: OutputValidationConfig = {
        type: 'zod',
        schema,
        strategy: 'block',
      };

      const processor = createOutputValidationProcessor(config);
      const ctx = makeContext(JSON.stringify({ name: 'Alice', age: 'not-a-number' }));
      const result = await executeProcessor(processor, ctx);
      expect(result.type).toBe('abort');
      expect(result.reason).toContain('Output validation failed');
    });
  });

  // ---------------------------------------------------------------------------
  // Plugin factory pattern
  // ---------------------------------------------------------------------------
  describe('plugin factory pattern', () => {
    it('returns a processor with stage processOutput', () => {
      const processor = createOutputValidationProcessor({
        type: 'json-schema',
        schema: { type: 'string' },
        strategy: 'block',
      });
      expect(processor.stage).toBe('processOutput');
    });
  });
});
