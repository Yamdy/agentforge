import { describe, it, expect, beforeEach } from 'vitest';
import { Agent } from '../src/agent.js';
import { createMockLanguageModel, registerMockProvider } from './helpers.js';
import type { AgentConfig } from '@primo-ai/sdk';

describe('Agent.abort()', () => {
  beforeEach(() => {
    registerMockProvider('abort-mock', () =>
      createMockLanguageModel({ text: 'Hello!' }),
    );
  });

  it('transitions state machine to "cancelled"', async () => {
    const config: AgentConfig = { model: 'abort-mock/test' };
    const agent = new Agent(config);

    // Run completes normally first
    await agent.run('hello');
    expect(agent.state).toBe('completed');

    // Now start a run and abort it
    registerMockProvider('abort-slow', () => {
      return {
        modelId: 'abort-slow-model',
        specificationVersion: 'v3',
        provider: 'mock',
        supportedUrls: {},
        async doGenerate() {
          await new Promise((r) => setTimeout(r, 200));
          return {
            content: [{ type: 'text' as const, text: 'slow' }],
            finishReason: { unified: 'stop' as const, raw: 'stop' },
            usage: { inputTokens: { total: 10, noCache: 10 }, outputTokens: { total: 5, text: 5 } },
          };
        },
        async doStream() {
          const stream = new ReadableStream({
            async start(controller) {
              await new Promise((r) => setTimeout(r, 200));
              controller.enqueue({ type: 'text-start', id: 'text-1' });
              controller.enqueue({ type: 'text-delta', id: 'text-1', delta: 'slow' });
              controller.enqueue({ type: 'text-end', id: 'text-1' });
              controller.enqueue({
                type: 'finish',
                finishReason: { unified: 'stop', raw: 'stop' },
                usage: { inputTokens: { total: 10, noCache: 10 }, outputTokens: { total: 5, text: 5 } },
              });
              controller.close();
            },
          });
          return { stream };
        },
      } as unknown as import('ai').LanguageModel;
    });

    const slowAgent = new Agent({ model: 'abort-slow/test', maxIterations: 100 });
    const runPromise = slowAgent.run('hello');

    // Give the loop a moment to start
    await new Promise((r) => setTimeout(r, 30));

    slowAgent.abort();

    // The run should throw due to abort
    await expect(runPromise).rejects.toThrow();

    // State should be cancelled
    expect(slowAgent.state).toBe('cancelled');
  });

  it('aborts the active AbortController (interrupts a running agent)', async () => {
    registerMockProvider('abort-ctrl', () => {
      return {
        modelId: 'abort-ctrl-model',
        specificationVersion: 'v3',
        provider: 'mock',
        supportedUrls: {},
        async doGenerate() {
          await new Promise((r) => setTimeout(r, 500));
          return {
            content: [{ type: 'text' as const, text: 'delayed' }],
            finishReason: { unified: 'stop' as const, raw: 'stop' },
            usage: { inputTokens: { total: 10, noCache: 10 }, outputTokens: { total: 5, text: 5 } },
          };
        },
        async doStream() {
          const stream = new ReadableStream({
            async start(controller) {
              await new Promise((r) => setTimeout(r, 500));
              controller.enqueue({ type: 'text-start', id: 'text-1' });
              controller.enqueue({ type: 'text-delta', id: 'text-1', delta: 'delayed' });
              controller.enqueue({ type: 'text-end', id: 'text-1' });
              controller.enqueue({
                type: 'finish',
                finishReason: { unified: 'stop', raw: 'stop' },
                usage: { inputTokens: { total: 10, noCache: 10 }, outputTokens: { total: 5, text: 5 } },
              });
              controller.close();
            },
          });
          return { stream };
        },
      } as unknown as import('ai').LanguageModel;
    });

    const agent = new Agent({ model: 'abort-ctrl/test', maxIterations: 100 });
    const runPromise = agent.run('hello');

    // Let the run start
    await new Promise((r) => setTimeout(r, 30));

    agent.abort();

    // The run should reject with an AbortError (DOMException)
    let thrownError: unknown;
    try {
      await runPromise;
    } catch (e) {
      thrownError = e;
    }

    expect(thrownError).toBeDefined();
    expect(thrownError).toBeInstanceOf(DOMException);
    expect((thrownError as DOMException).name).toBe('AbortError');
  });

  it('is idempotent — calling on pending agent is no-op, no error thrown', () => {
    const config: AgentConfig = { model: 'abort-mock/test' };
    const agent = new Agent(config);

    // Agent is in pending state — abort should be a no-op
    expect(agent.state).toBe('pending');
    expect(() => agent.abort()).not.toThrow();
    expect(agent.state).toBe('pending');
  });

  it('is idempotent — calling on already completed agent is no-op', async () => {
    const config: AgentConfig = { model: 'abort-mock/test' };
    const agent = new Agent(config);

    await agent.run('hello');
    expect(agent.state).toBe('completed');

    // Abort on completed agent should be no-op
    expect(() => agent.abort()).not.toThrow();
    expect(agent.state).toBe('completed');
  });

  it('after abort(), agent state is "cancelled"', async () => {
    registerMockProvider('abort-state', () => {
      return {
        modelId: 'abort-state-model',
        specificationVersion: 'v3',
        provider: 'mock',
        supportedUrls: {},
        async doGenerate() {
          await new Promise((r) => setTimeout(r, 300));
          return {
            content: [{ type: 'text' as const, text: 'running' }],
            finishReason: { unified: 'stop' as const, raw: 'stop' },
            usage: { inputTokens: { total: 10, noCache: 10 }, outputTokens: { total: 5, text: 5 } },
          };
        },
        async doStream() {
          const stream = new ReadableStream({
            async start(controller) {
              await new Promise((r) => setTimeout(r, 300));
              controller.enqueue({ type: 'text-start', id: 'text-1' });
              controller.enqueue({ type: 'text-delta', id: 'text-1', delta: 'running' });
              controller.enqueue({ type: 'text-end', id: 'text-1' });
              controller.enqueue({
                type: 'finish',
                finishReason: { unified: 'stop', raw: 'stop' },
                usage: { inputTokens: { total: 10, noCache: 10 }, outputTokens: { total: 5, text: 5 } },
              });
              controller.close();
            },
          });
          return { stream };
        },
      } as unknown as import('ai').LanguageModel;
    });

    const agent = new Agent({ model: 'abort-state/test', maxIterations: 100 });
    const runPromise = agent.run('hello');

    await new Promise((r) => setTimeout(r, 30));
    agent.abort();

    try { await runPromise; } catch { /* expected */ }

    expect(agent.state).toBe('cancelled');
  });
});
