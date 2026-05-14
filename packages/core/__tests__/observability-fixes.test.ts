import { describe, it, expect, beforeEach } from 'vitest';
import { Agent } from '../src/agent.js';
import { PipelineRunner } from '../src/pipeline.js';
import { ToolRegistry } from '../src/tool-registry.js';
import { TracerImpl, type SpanData } from '@agentforge/observability';
import { HookManager } from '../src/hook-manager.js';
import { EventBus } from '../src/event-bus.js';
import { LLMInvoker } from '../src/llm-invoker.js';
import { createMockLanguageModel, registerMockProvider } from './helpers.js';
import type { AgentConfig, Tracer, Span } from '@agentforge/sdk';
import { z } from 'zod';

/**
 * RED tests for observability fixes (P-1, P-2, P-4, P-5, P-15)
 * - P-1: Agent.getLLM() passes tracer to LLMInvoker
 * - P-2: TracerImpl.startSpan() propagates onSpanEnd so spans are exported
 * - P-4: llm.after hook receives populated response data
 * - P-5: agent.end fires even when an error occurs during run/stream
 * - P-15: tool.after hook receives result/error data from ToolRegistry
 */

describe('Observability fixes — RED phase', () => {
  beforeEach(() => {
    registerMockProvider('mock', (modelId) =>
      createMockLanguageModel({ text: `Hello from ${modelId}!` }),
    );
  });

  // ---------------------------------------------------------------------------
  // P-1: Agent.getLLM() must pass tracer to LLMInvoker
  // ---------------------------------------------------------------------------
  describe('P-1: Agent passes tracer to LLMInvoker', () => {
    it('LLMInvoker receives tracer from Agent dependencies', async () => {
      const tracer = new TracerImpl();
      const agent = new Agent(
        { model: 'mock/test' },
        { tracer },
      );

      const events: string[] = [];
      agent.eventBus.subscribe('stage:after', (data: any) => {
        events.push(data.stage);
      });

      await agent.run('hello again');
      expect(events).toContain('invokeLLM');
    });

    it('LLMInvoker creates spans when tracer is provided', async () => {
      const tracer = new TracerImpl();
      const model = createMockLanguageModel({ text: 'traced' });
      const invoker = new LLMInvoker({ model, tracer });

      const handle = invoker.stream({ messages: [{ role: 'user', content: 'test' }] });
      for await (const _ of handle.fullStream) { /* drain */ }
      await handle.usage;

      const span = tracer.startSpan('test');
      expect(span).toBeDefined();
      expect(span.spanContext().spanId).toBeTruthy();
    });
  });

  // ---------------------------------------------------------------------------
  // P-2: TracerImpl.startSpan() must call onSpanEnd callback when span ends
  // ---------------------------------------------------------------------------
  describe('P-2: TracerImpl exports ended spans via onSpanEnd', () => {
    it('startSpan propagates onSpanEnd so ended spans are reported', () => {
      const exported: SpanData[] = [];
      const onSpanEnd = (data: SpanData) => exported.push(data);

      const tracer = new TracerImpl(onSpanEnd);
      const span = tracer.startSpan('test-span');
      span.end();

      expect(exported.length).toBe(1);
      expect(exported[0].name).toBe('test-span');
      expect(exported[0].ended).toBe(true);
    });

    it('child spans also trigger onSpanEnd when ended', () => {
      const exported: SpanData[] = [];
      const onSpanEnd = (data: SpanData) => exported.push(data);

      const tracer = new TracerImpl(onSpanEnd);
      const parent = tracer.startSpan('parent');
      const child = parent.startChild('child');
      child.end();

      expect(exported.length).toBe(1);
      expect(exported[0].name).toBe('child');
    });
  });

  // ---------------------------------------------------------------------------
  // P-4: llm.after hook receives populated response (not undefined)
  // ---------------------------------------------------------------------------
  describe('P-4: llm.after hook receives response text', () => {
    it('llm.after hook output contains the LLM response text', async () => {
      const llmAfterData: { input: unknown; output: unknown }[] = [];

      const agent = new Agent({ model: 'mock/test' });
      agent.pluginManager.hookManager.register({
        point: 'llm.after',
        handler: (input, output) => {
          llmAfterData.push({ input, output });
        },
      });

      await agent.run('test');

      expect(llmAfterData.length).toBeGreaterThanOrEqual(1);

      const lastCall = llmAfterData[llmAfterData.length - 1];
      const response = (lastCall.output as Record<string, unknown>).response;
      expect(response).toBeDefined();
      expect(typeof response).toBe('string');
      expect(response as string).toContain('Hello from test');
    });
  });

  // ---------------------------------------------------------------------------
  // P-5: agent.end hook fires even when an error occurs
  // ---------------------------------------------------------------------------
  describe('P-5: agent.end fires on error', () => {
    it('agent.end hook fires when run() throws an error', async () => {
      const hookCalls: string[] = [];

      registerMockProvider('crash', () => {
        const model = createMockLanguageModel({ text: 'nope' });
        (model as any).doStream = async () => { throw new Error('LLM crash'); };
        return model;
      });

      const agent = new Agent({ model: 'crash/test' });

      agent.pluginManager.hookManager.register({
        point: 'agent.end',
        handler: () => { hookCalls.push('agent.end'); },
      });

      await expect(agent.run('crash test')).rejects.toThrow('LLM crash');

      expect(hookCalls).toContain('agent.end');
    });

    it('agent:end event fires on EventBus when run() throws', async () => {
      const events: string[] = [];

      registerMockProvider('err-event', () => {
        const model = createMockLanguageModel({ text: 'nope' });
        (model as any).doStream = async () => { throw new Error('Stream error'); };
        return model;
      });

      const agent = new Agent({ model: 'err-event/test' });
      agent.eventBus.subscribe('agent:end', () => events.push('agent:end'));
      agent.eventBus.subscribe('agent:start', () => events.push('agent:start'));

      await expect(agent.run('test')).rejects.toThrow('Stream error');

      expect(events).toContain('agent:start');
      expect(events).toContain('agent:end');
    });
  });

  // ---------------------------------------------------------------------------
  // P-15: ToolRegistry wires HookManager from Agent, tool.after has result/error
  // ---------------------------------------------------------------------------
  describe('P-15: tool.after hook fires with result data via Agent pipeline', () => {
    it('tool.after hook receives result when tool succeeds', async () => {
      const toolAfterCalls: { toolName: string; result: unknown; error?: string }[] = [];

      const myTool = {
        name: 'my_tool',
        description: 'A test tool',
        inputSchema: z.object({ x: z.number() }),
        execute: async ({ x }) => (x as number) * 2,
      };

      const registry = new ToolRegistry();
      const eventBus = new EventBus();
      const hookManager = new HookManager(eventBus);
      registry.setHookManager(hookManager);
      registry.register(myTool as any);

      hookManager.register({
        point: 'tool.after',
        handler: (input, output) => {
          toolAfterCalls.push({
            toolName: (input as Record<string, unknown>).toolName as string,
            result: (output as Record<string, unknown>).result,
            error: (output as Record<string, unknown>).error as string | undefined,
          });
        },
      });

      await registry.executeTool('my_tool', { x: 5 });

      expect(toolAfterCalls.length).toBe(1);
      expect(toolAfterCalls[0].toolName).toBe('my_tool');
      expect(toolAfterCalls[0].result).toBe(10);
      expect(toolAfterCalls[0].error).toBeUndefined();
    });

    it('tool.after hook receives error when tool fails', async () => {
      const toolAfterCalls: { toolName: string; error?: string }[] = [];

      const failTool = {
        name: 'fail_tool',
        description: 'Always fails',
        inputSchema: z.object({}),
        execute: async () => { throw new Error('Tool failed'); },
      };

      const registry = new ToolRegistry();
      const eventBus = new EventBus();
      const hookManager = new HookManager(eventBus);
      registry.setHookManager(hookManager);
      registry.register(failTool as any);

      hookManager.register({
        point: 'tool.after',
        handler: (input, output) => {
          toolAfterCalls.push({
            toolName: (input as Record<string, unknown>).toolName as string,
            error: (output as Record<string, unknown>).error as string | undefined,
          });
        },
      });

      await registry.executeTool('fail_tool', {});

      expect(toolAfterCalls.length).toBe(1);
      expect(toolAfterCalls[0].toolName).toBe('fail_tool');
      expect(toolAfterCalls[0].error).toBe('Tool failed');
    });
  });
});
