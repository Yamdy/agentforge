import { describe, it, expect } from 'vitest';
import type { Processor, ProcessorContext, ProcessorResult, PipelineContext } from '@primo-ai/sdk';

// ---------------------------------------------------------------------------
// Helper: minimal PipelineContext factory
// ---------------------------------------------------------------------------

function makeContext(overrides?: Partial<PipelineContext>): PipelineContext {
  return {
    agent: {
      config: { systemPrompt: 'test', maxIterations: 5 },
      toolDeclarations: [],
      promptFragments: [],
      providerOptions: {},
      ...overrides?.agent,
    },
    iteration: {
      step: 0,
      response: '',
      loopDirective: undefined,
      ...overrides?.iteration,
    },
    session: {
      input: 'hello',
      sessionId: 'test-session',
      messageHistory: [],
      custom: {},
      ...overrides?.session,
    },
  } as PipelineContext;
}

// ---------------------------------------------------------------------------
// F-5: ProcessorResult interface — observation fields
// ---------------------------------------------------------------------------

describe('ProcessorResult (F-5)', () => {
  describe('interface structure', () => {
    it('should accept ProcessorResult with all fields', () => {
      const result: ProcessorResult = {
        status: 'success',
        summary: 'Processed input successfully',
        nextActions: ['buildContext'],
        artifacts: { configFile: '/path/to/config.json' },
      };
      expect(result.status).toBe('success');
      expect(result.summary).toBe('Processed input successfully');
      expect(result.nextActions).toEqual(['buildContext']);
      expect(result.artifacts).toEqual({ configFile: '/path/to/config.json' });
    });

    it('should accept ProcessorResult with only required fields', () => {
      const result: ProcessorResult = {
        status: 'success',
        summary: 'Done',
      };
      expect(result.status).toBe('success');
      expect(result.summary).toBe('Done');
      expect(result.nextActions).toBeUndefined();
      expect(result.artifacts).toBeUndefined();
    });

    it('should accept all valid status values', () => {
      const success: ProcessorResult = { status: 'success', summary: 'ok' };
      const warning: ProcessorResult = { status: 'warning', summary: 'careful' };
      const error: ProcessorResult = { status: 'error', summary: 'failed' };
      expect(success.status).toBe('success');
      expect(warning.status).toBe('warning');
      expect(error.status).toBe('error');
    });
  });

  describe('Processor.execute returns ProcessorResult', () => {
    it('should allow Processor to return ProcessorResult', async () => {
      const processor: Processor = {
        stage: 'processInput',
        execute: async (_ctx: ProcessorContext): Promise<ProcessorResult> => {
          return {
            status: 'success',
            summary: 'Resolved dynamic config values',
            nextActions: ['buildContext'],
          };
        },
      };

      const result = await processor.execute({} as ProcessorContext);
      expect(result).toBeDefined();
      expect((result as ProcessorResult).status).toBe('success');
      expect((result as ProcessorResult).summary).toBe('Resolved dynamic config values');
    });

    it('should allow Processor to return void for backward compatibility', async () => {
      const processor: Processor = {
        stage: 'processInput',
        execute: async (_ctx: ProcessorContext): Promise<void> => {
          // Legacy processor that returns void
        },
      };

      const result = await processor.execute({} as ProcessorContext);
      expect(result).toBeUndefined();
    });

    it('should allow Processor to return ProcessorResult with warning status', async () => {
      const processor: Processor = {
        stage: 'gateLLM',
        execute: async (_ctx: ProcessorContext): Promise<ProcessorResult> => {
          return {
            status: 'warning',
            summary: 'Token budget nearing limit',
            nextActions: ['invokeLLM'],
            artifacts: { budgetUsage: '85%' },
          };
        },
      };

      const result = await processor.execute({} as ProcessorContext) as ProcessorResult;
      expect(result.status).toBe('warning');
      expect(result.summary).toBe('Token budget nearing limit');
    });

    it('should allow Processor to return ProcessorResult with error status', async () => {
      const processor: Processor = {
        stage: 'executeTools',
        execute: async (_ctx: ProcessorContext): Promise<ProcessorResult> => {
          return {
            status: 'error',
            summary: 'Tool execution failed: shell command timed out',
          };
        },
      };

      const result = await processor.execute({} as ProcessorContext) as ProcessorResult;
      expect(result.status).toBe('error');
      expect(result.summary).toContain('timed out');
    });
  });

  describe('PipelineRunner integration', () => {
    it('should emit processor_result event when Processor returns ProcessorResult', async () => {
      const { PipelineRunner } = await import('../src/pipeline.js');
      const { NoOpTracer } = await import('@primo-ai/observability');

      const runner = new PipelineRunner({ tracer: new NoOpTracer() });

      runner.register({
        stage: 'processInput',
        execute: async (_ctx: ProcessorContext): Promise<ProcessorResult> => ({
          status: 'success',
          summary: 'Input processed',
          nextActions: ['buildContext'],
        }),
      });

      const ctx = makeContext();
      const emitted: Array<{ type: string; [key: string]: unknown }> = [];
      for await (const event of runner.stream(ctx, ['processInput'])) {
        emitted.push(event);
      }

      const resultEvent = emitted.find(e => e.type === 'processor_result');
      expect(resultEvent).toBeDefined();
      expect((resultEvent as any).result.status).toBe('success');
      expect((resultEvent as any).result.summary).toBe('Input processed');
    });

    it('should not emit processor_result event when Processor returns void', async () => {
      const { PipelineRunner } = await import('../src/pipeline.js');
      const { NoOpTracer } = await import('@primo-ai/observability');

      const runner = new PipelineRunner({ tracer: new NoOpTracer() });

      runner.register({
        stage: 'processInput',
        execute: async (_ctx: ProcessorContext): Promise<void> => {
          // void return — no result event should be emitted
        },
      });

      const ctx = makeContext();
      const emitted: Array<{ type: string; [key: string]: unknown }> = [];
      for await (const event of runner.stream(ctx, ['processInput'])) {
        emitted.push(event);
      }

      const resultEvent = emitted.find(e => e.type === 'processor_result');
      expect(resultEvent).toBeUndefined();
    });
  });

  describe('built-in processors', () => {
    it('executeTools processor should return ProcessorResult when tools are executed', async () => {
      const { createExecuteToolsProcessor } = await import('../src/processors/execute-tools.js');
      const { ToolRegistry } = await import('../src/tool-registry.js');
      const { echoTool } = await import('@primo-ai/tools');

      const registry = new ToolRegistry();
      registry.register(echoTool);
      const processor = createExecuteToolsProcessor(registry);

      const ctx = makeContext({
        iteration: {
          step: 1,
          response: 'I will use a tool',
          pendingToolCalls: [{ id: '1', name: 'echo', args: { message: 'hello' } }],
          loopDirective: undefined,
        },
      });

      const pCtx = { state: ctx, control: {} as any } as ProcessorContext;
      const result = await processor.execute(pCtx);

      expect(result).toBeDefined();
      expect((result as ProcessorResult).status).toBe('success');
      expect((result as ProcessorResult).summary).toContain('echo');
      expect((result as ProcessorResult).artifacts).toBeDefined();
    });

    it('executeTools processor should return void when no tools to execute', async () => {
      const { createExecuteToolsProcessor } = await import('../src/processors/execute-tools.js');
      const { ToolRegistry } = await import('../src/tool-registry.js');

      const registry = new ToolRegistry();
      const processor = createExecuteToolsProcessor(registry);

      const ctx = makeContext({
        iteration: {
          step: 1,
          response: 'Done',
          pendingToolCalls: [],
          loopDirective: undefined,
        },
      });

      const pCtx = { state: ctx, control: {} as any } as ProcessorContext;
      const result = await processor.execute(pCtx);

      // No tool calls — should return void
      expect(result).toBeUndefined();
    });

    it('evaluateIteration processor should return ProcessorResult with nextActions', async () => {
      const { createEvaluateIterationProcessor } = await import('../src/processors/evaluate-iteration.js');

      const processor = createEvaluateIterationProcessor();

      const ctx = makeContext({
        iteration: {
          step: 1,
          response: 'Done',
          toolResults: [{ name: 'echo', output: 'hello', toolCallId: '1' }],
          tokenUsage: { input: 10, output: 20 },
          loopDirective: undefined,
        },
        session: {
          input: 'hello',
          sessionId: 'test',
          messageHistory: [],
          custom: {},
          totalTokenUsage: { input: 10, output: 20 },
        },
      });

      const pCtx = { state: ctx, control: {} as any, span: { setAttribute: () => {} } } as unknown as ProcessorContext;
      const result = await processor.execute(pCtx);

      expect(result).toBeDefined();
      expect((result as ProcessorResult).status).toBe('success');
      expect((result as ProcessorResult).summary).toBeDefined();
      expect((result as ProcessorResult).nextActions).toBeDefined();
    });

    it('processInput processor should return ProcessorResult', async () => {
      const { processInputProcessor } = await import('../src/processors/process-input.js');

      const ctx = makeContext();
      const pCtx = { state: ctx, control: {} as any } as ProcessorContext;
      const result = await processInputProcessor.execute(pCtx);

      expect(result).toBeDefined();
      expect((result as ProcessorResult).status).toBe('success');
      expect((result as ProcessorResult).summary).toBeDefined();
    });

    it('prepareStep processor should return ProcessorResult', async () => {
      const { prepareStepExtensionPoint } = await import('../src/processors/prepare-step.js');

      const ctx = makeContext();
      const pCtx = { state: ctx, control: {} as any } as ProcessorContext;
      const result = await prepareStepExtensionPoint.execute(pCtx);

      expect(result).toBeDefined();
      expect((result as ProcessorResult).status).toBe('success');
      expect((result as ProcessorResult).summary).toContain('Reset');
    });

    it('processStepOutput processor should return ProcessorResult', async () => {
      const { processStepOutputProcessor } = await import('../src/processors/process-step-output.js');

      const ctx = makeContext({
        iteration: {
          step: 0,
          response: 'Hello world',
          loopDirective: undefined,
        },
      });
      const pCtx = { state: ctx, control: {} as any } as ProcessorContext;
      const result = await processStepOutputProcessor.execute(pCtx);

      expect(result).toBeDefined();
      expect((result as ProcessorResult).status).toBe('success');
      expect((result as ProcessorResult).summary).toBeDefined();
    });
  });

  describe('adapters (modifiers/gates)', () => {
    it('message modifier should return ProcessorResult', async () => {
      const { modifiers } = await import('../src/adapters/modifiers.js');

      const processor = modifiers.message((msgs) => msgs);
      const ctx = makeContext();
      const pCtx = { state: ctx, control: {} as any } as ProcessorContext;

      const result = await processor.execute(pCtx);
      expect(result).toBeDefined();
      expect((result as ProcessorResult).status).toBe('success');
    });

    it('systemPrompt modifier should return ProcessorResult', async () => {
      const { modifiers } = await import('../src/adapters/modifiers.js');

      const processor = modifiers.systemPrompt((prompt) => prompt);
      const ctx = makeContext();
      const pCtx = { state: ctx, control: {} as any } as ProcessorContext;

      const result = await processor.execute(pCtx);
      expect(result).toBeDefined();
      expect((result as ProcessorResult).status).toBe('success');
    });

    it('tools modifier should return ProcessorResult', async () => {
      const { modifiers } = await import('../src/adapters/modifiers.js');

      const processor = modifiers.tools((tools) => tools);
      const ctx = makeContext();
      const pCtx = { state: ctx, control: {} as any } as ProcessorContext;

      const result = await processor.execute(pCtx);
      expect(result).toBeDefined();
      expect((result as ProcessorResult).status).toBe('success');
    });

    it('providerOptions modifier should return ProcessorResult', async () => {
      const { modifiers } = await import('../src/adapters/modifiers.js');

      const processor = modifiers.providerOptions((opts) => opts);
      const ctx = makeContext();
      const pCtx = { state: ctx, control: {} as any } as ProcessorContext;

      const result = await processor.execute(pCtx);
      expect(result).toBeDefined();
      expect((result as ProcessorResult).status).toBe('success');
    });
  });

  describe('EventBus integration', () => {
    it('should emit processor:result event on EventBus when ProcessorResult returned', async () => {
      const { PipelineRunner } = await import('../src/pipeline.js');
      const { NoOpTracer } = await import('@primo-ai/observability');
      const { EventBus } = await import('../src/event-bus.js');

      const eventBus = new EventBus();
      const events: unknown[] = [];
      eventBus.subscribe('processor:result', (data: unknown) => events.push(data));

      const runner = new PipelineRunner({ tracer: new NoOpTracer(), eventBus });

      runner.register({
        stage: 'processInput',
        execute: async (_ctx: ProcessorContext): Promise<ProcessorResult> => ({
          status: 'success',
          summary: 'Test summary',
        }),
      });

      const ctx = makeContext();
      for await (const _ of runner.stream(ctx, ['processInput'])) {
        // drain
      }

      expect(events).toHaveLength(1);
      expect((events[0] as any).processorResult.status).toBe('success');
      expect((events[0] as any).processorResult.summary).toBe('Test summary');
    });
  });
});
