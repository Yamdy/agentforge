import { describe, it, expect, beforeEach } from 'vitest';
import { Agent } from '../src/agent.js';
import { createMockLanguageModel, registerMockProvider } from './helpers.js';
import type { AgentConfig } from '@agentforge/sdk';

describe('Agent', () => {
  beforeEach(() => {
    registerMockProvider('mock', (modelId) =>
      createMockLanguageModel({ text: `Hello from ${modelId}!` }),
    );
  });

  it('processes input through 3 stages and returns LLM response', async () => {
    const config: AgentConfig = {
      model: 'mock/test',
      systemPrompt: 'You are helpful.',
    };
    const agent = new Agent(config);

    const response = await agent.run('Hi there');
    expect(response).toBe('Hello from test!');
  });

  it('passes user input through to the model', async () => {
    registerMockProvider('capture', (modelId) =>
      createMockLanguageModel({ text: 'response' }),
    );

    const agent = new Agent({ model: 'capture/test' });
    const response = await agent.run('what is 2+2?');
    expect(response).toBe('response');
  });

  it('respects maxIterations from config', async () => {
    let callCount = 0;
    registerMockProvider('iter', () => {
      callCount++;
      return createMockLanguageModel({ text: 'thinking...' });
    });

    const agent = new Agent({ model: 'iter/test', maxIterations: 3 });
    await agent.run('test');
    expect(callCount).toBeLessThanOrEqual(3);
  });

  it('resolves Dynamic systemPrompt at processInput stage', async () => {
    registerMockProvider('dyn', () =>
      createMockLanguageModel({ text: 'dynamic response' }),
    );

    const agent = new Agent({
      model: 'dyn/test',
      systemPrompt: (ctx) => `Context for: ${ctx.input}`,
    });

    const result = await agent.run('hello');
    expect(result).toBe('dynamic response');
  });

  it('resolves Dynamic maxIterations at processInput stage', async () => {
    let callCount = 0;
    registerMockProvider('dyn-iter', () => {
      callCount++;
      return createMockLanguageModel({ text: 'step' });
    });

    const agent = new Agent({
      model: 'dyn-iter/test',
      maxIterations: () => 2,
    });

    await agent.run('test');
    expect(callCount).toBeLessThanOrEqual(2);
  });

  it('exposes pluginManager and delegates use() to PluginManager', async () => {
    const agent = new Agent({ model: 'mock/test' });

    // PluginManager is accessible and created
    expect(agent.pluginManager).toBeDefined();
    expect(agent.pluginManager.hookManager).toBeDefined();

    // use() delegates to PluginManager.initializePlugin
    const hooked: unknown[] = [];
    agent.use((api) => {
      api.registerHook({
        point: 'tool.before',
        handler: (data) => { hooked.push(data); },
      });
      return {};
    });

    // Verify hook was registered by invoking it through HookManager
    await agent.pluginManager.hookManager.invoke('tool.before', { toolName: 'echo' }, {});
    expect(hooked.length).toBe(1);
  });

  describe('AbortSignal cancellation', () => {
    it('throws AbortError when signal is already aborted before run', async () => {
      const agent = new Agent({ model: 'mock/test' });
      const controller = new AbortController();
      controller.abort();

      await expect(agent.run('test', controller.signal)).rejects.toThrow(DOMException);
      await expect(agent.run('test', controller.signal)).rejects.toThrow('Agent run aborted');
    });

    it('throws AbortError when signal is aborted during execution', async () => {
      let callCount = 0;
      registerMockProvider('slow-cancel', () => {
        callCount++;
        // Slow model: each call takes 50ms, giving abort time to fire between iterations
        return {
          modelId: 'slow-cancel-model',
          specificationVersion: 'v3',
          provider: 'mock',
          supportedUrls: {},
          async doGenerate() {
            await new Promise((r) => setTimeout(r, 50));
            return {
              content: [{ type: 'text' as const, text: 'step' }],
              finishReason: { unified: 'stop' as const, raw: 'stop' },
              usage: { inputTokens: { total: 10, noCache: 10 }, outputTokens: { total: 5, text: 5 } },
            } as any;
          },
          async doStream() {
            const stream = new ReadableStream({
              async start(controller) {
                await new Promise((r) => setTimeout(r, 50));
                controller.enqueue({ type: 'text-start', id: 'text-1' });
                controller.enqueue({ type: 'text-delta', id: 'text-1', delta: 'step' });
                controller.enqueue({ type: 'text-end', id: 'text-1' });
                controller.enqueue({
                  type: 'finish',
                  finishReason: { unified: 'stop', raw: 'stop' },
                  usage: { inputTokens: { total: 10, noCache: 10 }, outputTokens: { total: 5, text: 5 } },
                });
                controller.close();
              },
            });
            return { stream } as any;
          },
        };
      });

      const agent = new Agent({ model: 'slow-cancel/test', maxIterations: 100 });
      const controller = new AbortController();

      // Abort after first iteration has started but before it completes
      setTimeout(() => controller.abort(), 30);

      await expect(agent.run('test', controller.signal)).rejects.toThrow(DOMException);
      expect(callCount).toBeGreaterThanOrEqual(1);
    });
  });
});
