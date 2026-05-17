import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Agent } from '../src/agent.js';
import { EventBus } from '../src/event-bus.js';
import { createSubAgentTool } from '../src/sub-agent.js';
import {
  createMockLanguageModel,
  createMockModelWithToolCalls,
  registerMockProvider,
} from './helpers.js';
import { z } from 'zod';
import type { PipelineContext } from '@primo-ai/sdk';

describe('Sub-agent mergeSessionState stale closure fix', () => {
  beforeEach(() => {
    registerMockProvider('merge-sub', () =>
      createMockLanguageModel({ text: 'Child done' }),
    );
  });
  it('step 0: parent state is merged into child session', async () => {
    const capturedProcessors: Array<{stage: string; execute: (ctx: PipelineContext) => Promise<PipelineContext>}> = [];
    const originalUse = Agent.prototype.use;
    Agent.prototype.use = function (processor: any) {
      if (processor.stage === 'prepareStep') capturedProcessors.push(processor);
      return originalUse.call(this, processor as any);
    };
    try {
      const parentModel = createMockModelWithToolCalls([{ toolName: 'w1', args: { task: 't' } }], 'Done');
      registerMockProvider('s0-parent', () => parentModel);
      registerMockProvider('s0-child', () => createMockLanguageModel({ text: 'Child done' }));
      const parentMessages = [
        { role: 'user' as const, content: 'parent q' },
        { role: 'assistant' as const, content: 'parent a' },
      ];
      const getSessionState = vi.fn(() => ({ messageHistory: parentMessages }));
      const eventBus = new EventBus();
      const subAgentTool = createSubAgentTool(
        { name: 'w1', description: 'Worker', model: 's0-child/mock', contextPolicy: 'inherit', inputSchema: z.object({ task: z.string() }) },
        { model: 's0-parent/mock', tools: [], eventBus, getSessionState },
      );
      const agent = new Agent({ model: 's0-parent/mock', tools: [subAgentTool] });
      await agent.run('Test step 0 merge');
    } finally { Agent.prototype.use = originalUse; }

    expect(capturedProcessors.length).toBeGreaterThanOrEqual(1);
    const processor = capturedProcessors[0];
    const ctxStep0 = { iteration: { step: 0 }, session: { messageHistory: [], custom: {} } };
    const result = await processor.execute(ctxStep0 as unknown as PipelineContext);
    expect(result.session.messageHistory).toHaveLength(2);
    expect(result.session.messageHistory).toContainEqual({ role: 'user', content: 'parent q' });
    expect(result.session.messageHistory).toContainEqual({ role: 'assistant', content: 'parent a' });
  });

  it('step 1+: parent state is NOT re-merged; child accumulates its own state', async () => {
    const capturedProcessors: Array<{stage: string; execute: (ctx: PipelineContext) => Promise<PipelineContext>}> = [];
    const originalUse = Agent.prototype.use;
    Agent.prototype.use = function (processor: any) {
      if (processor.stage === 'prepareStep') capturedProcessors.push(processor);
      return originalUse.call(this, processor as any);
    };
    try {
      const parentModel = createMockModelWithToolCalls([{ toolName: 'w2', args: { task: 't' } }], 'Done');
      registerMockProvider('s1-parent', () => parentModel);
      registerMockProvider('s1-child', () => createMockLanguageModel({ text: 'Child done' }));
      const parentMessages = [{ role: 'user' as const, content: 'parent q' }, { role: 'assistant' as const, content: 'parent a' }];
      const getSessionState = vi.fn(() => ({ messageHistory: parentMessages }));
      const eventBus = new EventBus();
      const subAgentTool = createSubAgentTool(
        { name: 'w2', description: 'Worker', model: 's1-child/mock', contextPolicy: 'inherit', inputSchema: z.object({ task: z.string() }) },
        { model: 's1-parent/mock', tools: [], eventBus, getSessionState },
      );
      const agent = new Agent({ model: 's1-parent/mock', tools: [subAgentTool] });
      await agent.run('Test step 1+ no re-merge');
    } finally { Agent.prototype.use = originalUse; }

    expect(capturedProcessors.length).toBeGreaterThanOrEqual(1);
    const processor = capturedProcessors[0];
    const ctxStep1 = { iteration: { step: 1 }, session: { messageHistory: [
      { role: 'user', content: 'parent q' },
      { role: 'assistant', content: 'parent a' },
      { role: 'user', content: 'child input' },
      { role: 'assistant', content: 'child response' },
    ], custom: {} } };
    const result = await processor.execute(ctxStep1 as unknown as PipelineContext);
    expect(result.session.messageHistory).toHaveLength(4);
    expect(result.session.messageHistory).toContainEqual({ role: 'user', content: 'child input' });
    expect(result.session.messageHistory).toContainEqual({ role: 'assistant', content: 'child response' });
  });

  it('child totalTokenUsage is preserved across iterations', async () => {
    const capturedProcessors: Array<{stage: string; execute: (ctx: PipelineContext) => Promise<PipelineContext>}> = [];
    const originalUse = Agent.prototype.use;
    Agent.prototype.use = function (processor: any) {
      if (processor.stage === 'prepareStep') capturedProcessors.push(processor);
      return originalUse.call(this, processor as any);
    };
    try {
      const parentModel = createMockModelWithToolCalls([{ toolName: 'w3', args: { task: 't' } }], 'Done');
      registerMockProvider('s2-parent', () => parentModel);
      registerMockProvider('s2-child', () => createMockLanguageModel({ text: 'Child done' }));
      const getSessionState = vi.fn(() => ({ messageHistory: [{ role: 'user', content: 'p' }], totalTokenUsage: { input: 100, output: 50 } }));
      const eventBus = new EventBus();
      const subAgentTool = createSubAgentTool({ name: 'w3', description: 'Worker', model: 's2-child/mock', contextPolicy: 'inherit', inputSchema: z.object({ task: z.string() }) }, { model: 's2-parent/mock', tools: [], eventBus, getSessionState });
      const agent = new Agent({ model: 's2-parent/mock', tools: [subAgentTool] });
      await agent.run('Test token preservation');
    } finally { Agent.prototype.use = originalUse; }

    expect(capturedProcessors.length).toBeGreaterThanOrEqual(1);
    const processor = capturedProcessors[0];
    const ctxStep1 = { iteration: { step: 1 }, session: { messageHistory: [
      { role: 'user', content: 'p' },
      { role: 'user', content: 'child msg' },
    ], totalTokenUsage: { input: 200, output: 150 }, custom: {} } };
    const result = await processor.execute(ctxStep1 as unknown as PipelineContext);
    expect(result.session.totalTokenUsage).toEqual({ input: 200, output: 150 });
  });

  it('parent array keys (messageHistory) are correctly concatenated on step 0', async () => {
    const capturedProcessors: Array<{stage: string; execute: (ctx: PipelineContext) => Promise<PipelineContext>}> = [];
    const originalUse = Agent.prototype.use;
    Agent.prototype.use = function (processor: any) {
      if (processor.stage === 'prepareStep') capturedProcessors.push(processor);
      return originalUse.call(this, processor as any);
    };
    try {
      const parentModel = createMockModelWithToolCalls([{ toolName: 'w4', args: { task: 't' } }], 'Done');
      registerMockProvider('s3-parent', () => parentModel);
      registerMockProvider('s3-child', () => createMockLanguageModel({ text: 'Child done' }));
      const parentMessages = [{ role: 'user' as const, content: 'p1' }, { role: 'assistant' as const, content: 'p2' }];
      const getSessionState = vi.fn(() => ({ messageHistory: parentMessages }));
      const eventBus = new EventBus();
      const subAgentTool = createSubAgentTool(
        { name: 'w4', description: 'Worker', model: 's3-child/mock', contextPolicy: 'inherit', inputSchema: z.object({ task: z.string() }) },
        { model: 's3-parent/mock', tools: [], eventBus, getSessionState },
      );
      const agent = new Agent({ model: 's3-parent/mock', tools: [subAgentTool] });
      await agent.run('Test array concat');
    } finally { Agent.prototype.use = originalUse; }

    expect(capturedProcessors.length).toBeGreaterThanOrEqual(1);
    const processor = capturedProcessors[0];
    const ctxStep0 = { iteration: { step: 0 }, session: { messageHistory: [{ role: 'user' as const, content: 'child-own' }], custom: {} } };
    const result = await processor.execute(ctxStep0 as unknown as PipelineContext);
    const history = result.session.messageHistory!;
    expect(history).toBeDefined();
    expect(history.length).toBeGreaterThanOrEqual(2);
  });

  it('scalar keys from parent do NOT overwrite child values on step 1+', async () => {
    const capturedProcessors: Array<{stage: string; execute: (ctx: PipelineContext) => Promise<PipelineContext>}> = [];
    const originalUse = Agent.prototype.use;
    Agent.prototype.use = function (processor: any) {
      if (processor.stage === 'prepareStep') capturedProcessors.push(processor);
      return originalUse.call(this, processor as any);
    };
    try {
      const parentModel = createMockModelWithToolCalls([{ toolName: 'w5', args: { task: 't' } }], 'Done');
      registerMockProvider('s4-parent', () => parentModel);
      registerMockProvider('s4-child', () => createMockLanguageModel({ text: 'Child done' }));
      const getSessionState = vi.fn(() => ({ messageHistory: [{ role: 'user', content: 'p' }], totalTokenUsage: { input: 10, output: 5 }, custom: { parentKey: 'parentVal' } }));
      const eventBus = new EventBus();
      const subAgentTool = createSubAgentTool(
        { name: 'w5', description: 'Worker', model: 's4-child/mock', contextPolicy: 'inherit', inputSchema: z.object({ task: z.string() }) },
        { model: 's4-parent/mock', tools: [], eventBus, getSessionState },
      );
      const agent = new Agent({ model: 's4-parent/mock', tools: [subAgentTool] });
      await agent.run('Test scalar');
    } finally { Agent.prototype.use = originalUse; }

    expect(capturedProcessors.length).toBeGreaterThanOrEqual(1);
    const processor = capturedProcessors[0];
    const ctxStep2 = { iteration: { step: 2 }, session: { messageHistory: [
      { role: 'user', content: 'p' },
      { role: 'user', content: 'c1' },
      { role: 'user', content: 'c2' },
    ], totalTokenUsage: { input: 500, output: 300 }, custom: { childKey: 'childVal', parentKey: 'overwritten-by-child' } } };
    const result = await processor.execute(ctxStep2 as unknown as PipelineContext);
    expect(result.session.totalTokenUsage).toEqual({ input: 500, output: 300 });
    expect(result.session.messageHistory).toHaveLength(3);
    expect(result.session.custom.childKey).toBe('childVal');
    expect(result.session.custom.parentKey).toBe('overwritten-by-child');
  });

  it('isolated policy: no merge happens at all', async () => {
    const capturedProcessors: Array<{stage: string; execute: (ctx: PipelineContext) => Promise<PipelineContext>}> = [];
    const originalUse = Agent.prototype.use;
    Agent.prototype.use = function (processor: any) {
      if (processor.stage === 'prepareStep') capturedProcessors.push(processor);
      return originalUse.call(this, processor as any);
    };
    try {
      const parentModel = createMockModelWithToolCalls([{ toolName: 'w6', args: { task: 't' } }], 'Done');
      registerMockProvider('s5-parent', () => parentModel);
      registerMockProvider('s5-child', () => createMockLanguageModel({ text: 'Child done' }));
      const getSessionState = vi.fn(() => ({ messageHistory: [{ role: 'user', content: 'secret' }] }));
      const eventBus = new EventBus();
      const subAgentTool = createSubAgentTool({ name: 'w6', description: 'Worker', model: 's5-child/mock', contextPolicy: 'isolated', inputSchema: z.object({ task: z.string() }) }, { model: 's5-parent/mock', tools: [], eventBus, getSessionState });
      const agent = new Agent({ model: 's5-parent/mock', tools: [subAgentTool] });
      await agent.run('Test isolated');
    } finally { Agent.prototype.use = originalUse; }
    expect(capturedProcessors.length).toBe(0);
  });
});
