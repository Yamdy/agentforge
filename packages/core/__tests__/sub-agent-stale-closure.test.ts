import { describe, it, expect, vi } from 'vitest';
import { Agent } from '../src/agent.js';
import { EventBus } from '../src/event-bus.js';
import { createSubAgentTool } from '../src/sub-agent.js';
import {
  createMockLanguageModel,
  createMockModelWithToolCalls,
  registerMockProvider,
} from './helpers.js';
import { z } from 'zod';
import type { PipelineContext, ProcessorContext, ProcessorControl } from '@primo-ai/sdk';

/**
 * Fix 1: Sub-agent stale closure -- mergeSessionState
 *
 * Problem: parentState is captured once at registration, then the prepareStep
 * processor re-merges it on EVERY loop iteration, overwriting scalar keys
 * like totalTokenUsage with the parent's stale value.
 *
 * Solution: Gate the merge on ctx.iteration.step === 0.
 */
describe('Sub-agent stale closure: mergeSessionState gated by step === 0', () => {
  // Mock control for ProcessorContext
  const mockControl: ProcessorControl = {
    abort: () => { throw new Error('abort'); },
    suspend: () => { throw new Error('suspend'); },
    error: () => { throw new Error('error'); },
  };

  // Helper to wrap PipelineContext as ProcessorContext
  function wrapContext(ctx: PipelineContext): ProcessorContext {
    return { state: ctx, control: mockControl };
  }

  /**
   * Helper: intercept Agent.prototype.use to capture the prepareStep processor
   * registered by createSubAgentTool, so we can invoke it with synthetic contexts.
   */
  function runCapturingProcessor(
    providerPrefix: string,
    toolName: string,
    contextPolicy: 'inherit' | 'isolated' | 'summary-only',
    parentState: Record<string, unknown>,
  ): Promise<{
    processors: Array<{ stage: string; execute: (ctx: ProcessorContext) => Promise<PipelineContext | void> }>;
  }> {
    const processors: Array<{ stage: string; execute: (ctx: ProcessorContext) => Promise<PipelineContext | void> }> = [];
    const originalUse = Agent.prototype.use;
    Agent.prototype.use = function (processor: any) {
      if (processor && processor.stage === 'prepareStep') {
        processors.push(processor);
      }
      return originalUse.call(this, processor as any);
    };

    const parentModel = createMockModelWithToolCalls(
      [{ toolName, args: { task: 't' } }],
      'Done',
    );
    registerMockProvider(`${providerPrefix}-parent`, () => parentModel);
    registerMockProvider(`${providerPrefix}-child`, () =>
      createMockLanguageModel({ text: 'Child done' }),
    );

    const getSessionState = vi.fn(() => parentState);
    const eventBus = new EventBus();

    const subAgentTool = createSubAgentTool(
      {
        name: toolName,
        description: 'Worker',
        model: `${providerPrefix}-child/mock`,
        contextPolicy,
        inputSchema: z.object({ task: z.string() }),
      },
      {
        model: `${providerPrefix}-parent/mock`,
        tools: [],
        eventBus,
        getSessionState,
      },
    );

    const agent = new Agent({
      model: `${providerPrefix}-parent/mock`,
      tools: [subAgentTool],
    });

    return agent.run('Test').then(() => {
      Agent.prototype.use = originalUse;
      return { processors };
    }).catch((err) => {
      Agent.prototype.use = originalUse;
      throw err;
    });
  }

  it('step 0: parent totalTokenUsage is merged into child session', async () => {
    const { processors } = await runCapturingProcessor(
      'stale-s0', 'ws0', 'inherit',
      { totalTokenUsage: { input: 100, output: 50 } },
    );

    expect(processors.length).toBeGreaterThanOrEqual(1);
    const processor = processors[0];

    // Step 0: child starts with empty session
    const ctxStep0 = {
      iteration: { step: 0 },
      session: { custom: {} },
    } as unknown as PipelineContext;

    await processor.execute(wrapContext(ctxStep0));
    expect(ctxStep0.session.totalTokenUsage).toEqual({ input: 100, output: 50 });
  });

  it('step 1: child accumulated totalTokenUsage is NOT overwritten by stale parent', async () => {
    const { processors } = await runCapturingProcessor(
      'stale-s1', 'ws1', 'inherit',
      { totalTokenUsage: { input: 100, output: 50 } },
    );

    expect(processors.length).toBeGreaterThanOrEqual(1);
    const processor = processors[0];

    // Step 1: child has accumulated its own totalTokenUsage
    const ctxStep1 = {
      iteration: { step: 1 },
      session: {
        totalTokenUsage: { input: 200, output: 100 },
        custom: {},
      },
    } as unknown as PipelineContext;

    await processor.execute(wrapContext(ctxStep1));

    // Child's accumulated values must NOT be overwritten by stale parent state
    expect(ctxStep1.session.totalTokenUsage).toEqual({ input: 200, output: 100 });
  });

  it('step 2: child values still preserved', async () => {
    const { processors } = await runCapturingProcessor(
      'stale-s2', 'ws2', 'inherit',
      { totalTokenUsage: { input: 100, output: 50 } },
    );

    const processor = processors[0];

    const ctxStep2 = {
      iteration: { step: 2 },
      session: {
        totalTokenUsage: { input: 500, output: 300 },
        custom: { childKey: 'childVal' },
      },
    } as unknown as PipelineContext;

    await processor.execute(wrapContext(ctxStep2));
    expect(ctxStep2.session.totalTokenUsage).toEqual({ input: 500, output: 300 });
    expect(ctxStep2.session.custom.childKey).toBe('childVal');
  });

  it('isolated policy: no prepareStep processor is registered', async () => {
    const { processors } = await runCapturingProcessor(
      'stale-iso', 'wiso', 'isolated',
      { totalTokenUsage: { input: 100, output: 50 } },
    );

    // No prepareStep processor should have been registered for 'isolated' policy
    expect(processors).toHaveLength(0);
  });

  it('step 0: parent messageHistory array is correctly concatenated', async () => {
    const parentMessages = [
      { role: 'user' as const, content: 'parent q' },
      { role: 'assistant' as const, content: 'parent a' },
    ];
    const { processors } = await runCapturingProcessor(
      'stale-arr', 'warr', 'inherit',
      { messageHistory: parentMessages },
    );

    const processor = processors[0];

    // Step 0 with empty child history
    const ctxStep0 = {
      iteration: { step: 0 },
      session: { custom: {} },
    } as unknown as PipelineContext;

    await processor.execute(wrapContext(ctxStep0));
    const history = ctxStep0.session.messageHistory;
    expect(history).toHaveLength(2);
    expect(history).toContainEqual({ role: 'user', content: 'parent q' });
    expect(history).toContainEqual({ role: 'assistant', content: 'parent a' });
  });

  it('step 1: child messageHistory is NOT re-merged with parent', async () => {
    const parentMessages = [
      { role: 'user' as const, content: 'parent q' },
      { role: 'assistant' as const, content: 'parent a' },
    ];
    const { processors } = await runCapturingProcessor(
      'stale-arr2', 'warr2', 'inherit',
      { messageHistory: parentMessages },
    );

    const processor = processors[0];

    // Step 1: child has accumulated its own messages
    const ctxStep1 = {
      iteration: { step: 1 },
      session: {
        messageHistory: [
          { role: 'user', content: 'parent q' },
          { role: 'assistant', content: 'parent a' },
          { role: 'user', content: 'child input' },
          { role: 'assistant', content: 'child response' },
        ],
        custom: {},
      },
    } as unknown as PipelineContext;

    await processor.execute(wrapContext(ctxStep1));
    // Must have exactly 4 messages, not re-merged
    expect(ctxStep1.session.messageHistory).toHaveLength(4);
    expect(ctxStep1.session.messageHistory).toContainEqual(
      expect.objectContaining({ content: 'child input' }),
    );
    expect(ctxStep1.session.messageHistory).toContainEqual(
      expect.objectContaining({ content: 'child response' }),
    );
  });
});
