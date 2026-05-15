import { describe, it, expect, beforeEach } from 'vitest';
import { Agent } from '../src/agent.js';
import { createMockLanguageModel, createMockModelWithToolCalls, registerMockProvider } from './helpers.js';
import type { AbortSignal, PipelineContext, PipelineStage, Tool } from '@agentforge/sdk';
import type { ToolRegistry } from '../src/tool-registry.js';
import { z } from 'zod';

describe('Full Pipeline Stages', () => {
  beforeEach(() => {
    registerMockProvider('mock', (modelId) =>
      createMockLanguageModel({ text: `Response from ${modelId}` }),
    );
  });

  it('executes all 8 stages in correct order', async () => {
    const order: PipelineStage[] = [];
    const allStages: PipelineStage[] = [
      'processInput',
      'buildContext',
      'prepareStep',
      'invokeLLM',
      'processStepOutput',
      'executeTools',
      'evaluateIteration',
      'processOutput',
    ];

    const agent = new Agent({ model: 'mock/test', maxIterations: 1 });

    for (const stage of allStages) {
      agent.use({
        stage,
        execute: async (ctx) => {
          order.push(stage);
          return ctx;
        },
      });
    }

    await agent.run('Hello');
    expect(order).toEqual(allStages);
  });

  it('buildContext injects systemPrompt and tool declarations into context', async () => {
    const calcTool: Tool<{ a: number; b: number }, number> = {
      name: 'calc',
      description: 'Calculate numbers',
      inputSchema: z.object({ a: z.number(), b: z.number() }),
      execute: async ({ a, b }) => a + b,
    };

    let capturedCtx: PipelineContext | undefined;

    const agent = new Agent({
      model: 'mock/test',
      systemPrompt: 'You are a math assistant.',
      tools: [calcTool],
      maxIterations: 1,
    });

    agent.use({
      stage: 'prepareStep',
      execute: async (ctx) => {
        capturedCtx = ctx;
        return ctx;
      },
    });

    await agent.run('What is 2+2?');

    expect(capturedCtx).toBeDefined();
    expect(capturedCtx!.agent.systemPrompt).toBe('You are a math assistant.');
    const tools = capturedCtx!.agent.toolDeclarations as { name: string; description: string }[];
    expect(tools).toEqual(
      expect.arrayContaining([
        { name: 'calc', description: 'Calculate numbers' },
        { name: 'echo', description: expect.any(String) },
      ]),
    );
  });

  it('evaluateIteration stops agentic loop at maxIterations', async () => {
    let stepCount = 0;

    const agent = new Agent({ model: 'mock/test', maxIterations: 3 });

    // Override evaluateIteration to never stop, forcing maxIterations to control
    agent.use({
      stage: 'evaluateIteration',
      execute: async (ctx) => {
        // Return context without setting loopDirective to stop, so loop continues
        return { ...ctx, iteration: { ...ctx.iteration, loopDirective: undefined } };
      },
    });

    // Track how many times the loop iterates
    agent.use({
      stage: 'prepareStep',
      execute: async (ctx) => {
        stepCount++;
        return ctx;
      },
    });

    await agent.run('Hello');
    expect(stepCount).toBe(3);
  });

  it('TripWire abort stops the pipeline with a reason', async () => {
    const agent = new Agent({ model: 'mock/test', maxIterations: 1 });

    agent.use({
      stage: 'processStepOutput',
      execute: async (_ctx): Promise<AbortSignal> => ({
        type: 'abort',
        reason: 'Safety guardrail triggered',
      }),
    });

    await expect(agent.run('Do something bad')).rejects.toThrow(
      'Agent aborted: Safety guardrail triggered',
    );
  });

  it('TripWire retry restarts from prepareStep', async () => {
    const order: string[] = [];
    let retryCount = 0;

    const agent = new Agent({ model: 'mock/test', maxIterations: 5 });

    agent.use({
      stage: 'processStepOutput',
      execute: async (ctx) => {
        retryCount++;
        if (retryCount === 1) {
          order.push('retry');
          return {
            type: 'abort' as const,
            reason: 'Output rejected, retry',
            retryFrom: 'prepareStep' as PipelineStage,
          };
        }
        order.push('accepted');
        return ctx;
      },
    });

    agent.use({
      stage: 'prepareStep',
      execute: async (ctx) => {
        order.push(`prepare:${ctx.iteration.step}`);
        return ctx;
      },
    });

    await agent.run('Hello');
    // First iteration: prepareStep -> invokeLLM -> processStepOutput(retry)
    // Retry: prepareStep -> invokeLLM -> processStepOutput(accept) -> ... -> evaluateIteration(stop)
    expect(order).toContain('retry');
    expect(order).toContain('accepted');
    // prepareStep should be called at least twice (initial + retry)
    const prepareCount = order.filter(s => s.startsWith('prepare:')).length;
    expect(prepareCount).toBeGreaterThanOrEqual(2);
  });

  it('retryFrom invokeLLM skips prepareStep on retry', async () => {
    let prepareCount = 0;
    let invokeCount = 0;
    let retryCount = 0;

    const agent = new Agent({ model: 'mock/test', maxIterations: 5 });

    agent.use({
      stage: 'processStepOutput',
      execute: async (ctx) => {
        retryCount++;
        if (retryCount === 1) {
          return {
            type: 'abort' as const,
            reason: 'Output rejected, retry from invokeLLM',
            retryFrom: 'invokeLLM' as PipelineStage,
          };
        }
        return ctx;
      },
    });

    agent.use({
      stage: 'prepareStep',
      execute: async (ctx) => {
        prepareCount++;
        return ctx;
      },
    });

    agent.use({
      stage: 'invokeLLM',
      execute: async (ctx) => {
        invokeCount++;
        return ctx;
      },
    });

    await agent.run('Hello');

    // prepareStep should run exactly once (first iteration only; retry skips it)
    expect(prepareCount).toBe(1);
    // invokeLLM should run twice (first iteration + retry iteration)
    expect(invokeCount).toBe(2);
  });

  it('ContextBuilder trims messageHistory when budget is exceeded', async () => {
    const { ContextBuilder } = await import('../src/context-builder.js');
    const mockRegistry = {
      getAll: () => [{ name: 'myTool', description: 'should survive' }],
      register: () => {},
      unregister: () => false,
      get: () => undefined,
      setHookManager: () => {},
      setEventBus: () => {},
    } as unknown as ToolRegistry;

    const cb = new ContextBuilder({ registry: mockRegistry, budget: { maxTokens: 100 } });
    const processor = cb.createProcessor();

    const longHistory = Array.from({ length: 60 }, (_, i) => ({
      role: 'user' as const,
      content: `msg ${i}`,
    }));

    const ctx: PipelineContext = {
      request: { input: 'test', sessionId: 's1' },
      agent: {
        config: { model: 'mock/test' },
        toolDeclarations: [],
        promptFragments: ['keep me'],
      },
      iteration: { step: 0 },
      session: { messageHistory: longHistory, custom: {} },
    };

    const result = (await processor.execute(ctx)) as PipelineContext;

    // messageHistory trimmed by default semantic truncation to fit budget
    expect(result.session.messageHistory!.length).toBeLessThan(60);
    expect(result.session.messageHistory!.length).toBeGreaterThan(0);

    // toolDeclarations resolved from registry
    expect(result.agent.toolDeclarations).toEqual([{ name: 'myTool', description: 'should survive' }]);
    // promptFragments preserved
    expect(result.agent.promptFragments).toEqual(['keep me']);
  });

  it('end-to-end: agent calls tool, loops, and produces final output', async () => {
    const calcTool: Tool<{ a: number; b: number }, number> = {
      name: 'add',
      description: 'Add two numbers',
      inputSchema: z.object({ a: z.number(), b: z.number() }),
      execute: async ({ a, b }) => a + b,
    };

    // First LLM call returns tool call, second returns final text
    registerMockProvider('e2e', () =>
      createMockModelWithToolCalls(
        [{ toolName: 'add', args: { a: 2, b: 3 } }],
        'The answer is 5.',
      ),
    );

    const agent = new Agent({
      model: 'e2e/mock',
      systemPrompt: 'You are a calculator.',
      tools: [calcTool],
      maxIterations: 5,
    });

    const result = await agent.run('What is 2+3?');
    expect(result.response).toBe('The answer is 5.');
  });
});
